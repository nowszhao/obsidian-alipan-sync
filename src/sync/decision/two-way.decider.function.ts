import { parse as bytesParse } from 'bytes-iec'
import { SyncMode } from '~/settings'
import { hasFilenameError } from '~/utils/has-invalid-char'
import { isSameTime } from '~/utils/is-same-time'
import logger from '~/utils/logger'
import { remotePathToLocalPath } from '~/utils/remote-path-to-local-path'
import { ConflictStrategy } from '../tasks/conflict-resolve.task'
import { SkipReason } from '../tasks/skipped.task'
import { BaseTask } from '../tasks/task.interface'
import {
	getIgnoredPathsInFolder,
	hasIgnoredInFolder,
} from '../utils/has-ignored-in-folder'
import { hasFolderContentChanged } from './has-folder-content-changed'
import { SyncDecisionInput } from './sync-decision.interface'
import { StatModel } from '~/model/stat.model'

export async function twoWayDecider(
	input: SyncDecisionInput,
): Promise<BaseTask[]> {
	const {
		settings,
		localStats,
		remoteStats,
		syncRecords,
		remoteBaseDir,
		getBaseContent,
		compareFileContent,
		compareLocalRemote,
		taskFactory,
		
	} = input

	// Compact decision logger — only logs the reason and path
	const logDecision = (reason: string, path: string) => {
		logger.debug(`[decide] ${reason}: ${path}`)
	}

	let maxFileSize = Infinity
	const maxFileSizeStr = settings.skipLargeFiles.maxSize.trim()
	if (maxFileSizeStr !== '') {
		maxFileSize = bytesParse(maxFileSizeStr, { mode: 'jedec' }) ?? Infinity
	}
	const isContentSameOrUndecided = async (
		local: StatModel,
		remote: StatModel,
	): Promise<boolean> => {
		if (!compareLocalRemote) return true   // 未注入 → 退回 size 猜测（兼容测试）
		return (await compareLocalRemote(local, remote)) !== false
	}
	// Filter out ignored files and extract StatModel from FsWalkResult
	const localStatsFiltered = localStats
		.filter((item) => !item.ignored)
		.map((item) => item.stat)
	const remoteStatsFiltered = remoteStats
		.filter((item) => !item.ignored)
		.map((item) => item.stat)

	const localStatsMap = new Map(
		localStatsFiltered.map((item) => [item.path, item]),
	)
	const remoteStatsMap = new Map(
		remoteStatsFiltered.map((item) => [item.path, item]),
	)
	const mixedPath = new Set([...localStatsMap.keys(), ...remoteStatsMap.keys()])

	logger.debug(
		`Sync decision: ${localStatsFiltered.length} local items, ${remoteStatsFiltered.length} remote items, ${mixedPath.size} unique paths, ${syncRecords.size} sync records`,
	)

	// ── Remote-empty protection ──
	const remoteFileCount = remoteStatsFiltered.filter((s) => !s.isDir).length
	const localFileCount = localStatsFiltered.filter((s) => !s.isDir).length
	const fileRecordCount = [...syncRecords.values()].filter(
		(r) => !r.local.isDir,
	).length

	if (
		remoteFileCount === 0 &&
		fileRecordCount > 0 &&
		localFileCount > 0
	) {
		logger.info(
			`⚠ Remote has no files (${remoteStatsFiltered.length} folders only) but ${fileRecordCount} file records and ${localFileCount} local files exist. ` +
			`Clearing stale sync records to prevent accidental local deletion (treating as first sync).`,
		)
		syncRecords.clear()
	}

	const tasks: BaseTask[] = []
	const removeRemoteFolderTasks: BaseTask[] = []
	const removeLocalFolderTasks: BaseTask[] = []
	const mkdirLocalTasks: BaseTask[] = []
	const mkdirRemoteTasks: BaseTask[] = []
	const noopFolderTasks: BaseTask[] = []

	// ════════════════════════════════════════════════════════════════════
	// 文件决策真值表（local / remote / record / localChanged / remoteChanged）
	//  	┌ local  remote  record  L变  R变 ─ 决策
	//  1.	│  ✓      ✗       ✗      -    -   → push（本地新文件）
	//  2.	│  ✓      ✗       ✓      ✓    -   → push（本地变、远端删）
	//  3.	│  ✓      ✗       ✓      ✗    -   → remove-local（本地没变、远端删）
	//  4.	│  ✗      ✓       ✗      -    -   → pull（远端新文件）
	//  5.	│  ✗      ✓       ✓      -    ✓   → pull（远端变、本地删）
	//  6.	│  ✗      ✓       ✓      -    ✗   → remove-remote（远端没变、本地删）
	//  7.	│  ✓      ✓       ✗      -    -   → LOOSE特例noop / conflict
	//  8.	│  ✓      ✓       ✓      ✗    ✗   → noop（都没变）
	//  9.	│  ✓      ✓       ✓      ✓    ✗   → push
	//  10.	│  ✓      ✓       ✓      ✗    ✓   → pull
	//  11.	│  ✓      ✓       ✓      ✓    ✓   → conflict
	// 	 └ 每个动作前 guard：size>max → SkippedTask(FileTooLarge)；
	//     文件名非法 → FilenameErrorTask
	// ════════════════════════════════════════════════════════════════════

	// * sync files
	for (const p of mixedPath) {
		const remote = remoteStatsMap.get(p)
		const local = localStatsMap.get(p)
		const record = syncRecords.get(p)
		const options = {
			remotePath: p,
			localPath: p,
			remoteBaseDir,
		}
		// 文件夹：下方两个 folder 循环单独处理
		if (local?.isDir || remote?.isDir) {
			continue
		}

	
		//1. ── 仅本地存在 ──
		if (local && !remote) {
			// 本地新文件 / 本地变（远端已删）
			if (!record) {
				logDecision('local only, no record → push', p)
				if (local.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						localSize: local.size,
						maxSize: maxFileSize,
					}))
					continue
				}
				if (hasFilenameError(local.path)) {
					tasks.push(taskFactory.createFilenameErrorTask(options))
				} else {
					tasks.push(taskFactory.createPushTask(options))
				}
				continue
			}

			const localChanged = !isSameTime(local.mtime, record.local.mtime)
			if (localChanged) {
				logDecision('local changed, no remote → push', p)
				if (local.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						localSize: local.size,
						maxSize: maxFileSize,
					}))
					continue
				}
				if (hasFilenameError(local.path)) {
					tasks.push(taskFactory.createFilenameErrorTask(options))
				} else {
					tasks.push(taskFactory.createPushTask(options))
				}
				continue
			}

			logDecision('local not changed, no remote → remove local', p)
			tasks.push(taskFactory.createRemoveLocalTask(options))
			continue
		}

		//2. ── 仅远端存在 ──
		if (!local && remote) {
			// 远端新文件 / 远端变（本地已删）
			if (!record) {
				logDecision('remote only, no record → pull', p)
				if (remote.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						remoteSize: remote.size,
						maxSize: maxFileSize,
					}))
					continue
				}
				tasks.push(
					taskFactory.createPullTask({ ...options, remoteSize: remote.size }),
				)
				continue
			}

			const remoteChanged = !isSameTime(remote.mtime, record.remote.mtime)
			if (remoteChanged) {
				logDecision('remote changed, no local → pull', p)
				if (remote.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						remoteSize: remote.size,
						maxSize: maxFileSize,
					}))
					continue
				}
				tasks.push(
					taskFactory.createPullTask({ ...options, remoteSize: remote.size }),
				)
				continue
			}

			logDecision('remote not changed, no local → remove remote', p)
			tasks.push(taskFactory.createRemoveRemoteTask(options))
			continue
		}

		//3. ── 双方存在、无记录（首次相遇）──
		if (local && remote && !record) {
			if (
				settings.syncMode === SyncMode.LOOSE &&
				!remote.isDeleted &&
				!remote.isDir &&
				remote.size === local.size&&
   				(await isContentSameOrUndecided(local, remote))
			) {
				tasks.push(taskFactory.createNoopTask({ ...options }))
				continue
			}
			logDecision('both exist, no record → conflict', p)
			if (remote.size > maxFileSize || local.size > maxFileSize) {
				tasks.push(taskFactory.createSkippedTask({
					...options,
					reason: SkipReason.FileTooLarge,
					remoteSize: remote.size,
					localSize: local.size,
					maxSize: maxFileSize,
				}))
				continue
			}
			if (hasFilenameError(local.path)) {
				tasks.push(taskFactory.createFilenameErrorTask(options))
			} else {
				tasks.push(taskFactory.createConflictResolveTask({
					...options,
					strategy: ConflictStrategy.DiffMatchPatch,
					localStat: local,
					remoteStat: remote,
					useGitStyle: settings.useGitStyle,
					nonMarkdownStrategy: settings.nonMarkdownConflictStrategy,
				}))
			}
			continue
		}

		//4. ── 双方存在、有记录 → 按 changed 组合 ──
			if (local && remote && record) {
			let localChanged = !isSameTime(local.mtime, record.local.mtime)
			if (localChanged && record.base?.key) {
				const baseContent = await getBaseContent(record.base.key)
				if (baseContent) {
					localChanged = !(await compareFileContent(local.path, baseContent))
				}
			}
			const remoteChanged = !isSameTime(remote.mtime, record.remote.mtime)

			if (!localChanged && !remoteChanged) {
				// noop — 都没变
				continue
			}

			if (localChanged && !remoteChanged) {
				logDecision('local changed → push', p)
				if (local.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						maxSize: maxFileSize,
						remoteSize: remote.size,
						localSize: local.size,
					}))
					continue
				}
				if (hasFilenameError(local.path)) {
					tasks.push(taskFactory.createFilenameErrorTask(options))
				} else {
					tasks.push(taskFactory.createPushTask(options))
				}
				continue
			}

			if (!localChanged && remoteChanged) {
				logDecision('remote changed → pull', p)
				if (remote.size > maxFileSize) {
					tasks.push(taskFactory.createSkippedTask({
						...options,
						reason: SkipReason.FileTooLarge,
						maxSize: maxFileSize,
						remoteSize: remote.size,
					}))
					continue
				}
				tasks.push(
					taskFactory.createPullTask({ ...options, remoteSize: remote.size }),
				)
				continue
			}

			// both changed → conflict
			logDecision('both changed → conflict', p)
			if (remote.size > maxFileSize || local.size > maxFileSize) {
				tasks.push(taskFactory.createSkippedTask({
					...options,
					reason: SkipReason.FileTooLarge,
					maxSize: maxFileSize,
					remoteSize: remote.size,
					localSize: local.size,
				}))
				continue
			}
			if (hasFilenameError(local.path)) {
				tasks.push(taskFactory.createFilenameErrorTask(options))
			} else {
				tasks.push(taskFactory.createConflictResolveTask({
					...options,
					record,
					strategy:
						settings.conflictStrategy === 'latest-timestamp'
							? ConflictStrategy.LatestTimeStamp
							: ConflictStrategy.DiffMatchPatch,
					localStat: local,
					remoteStat: remote,
					useGitStyle: settings.useGitStyle,
					nonMarkdownStrategy: settings.nonMarkdownConflictStrategy,
				}))
			}
		}
	}

	// * clean orphaned records (both local and remote deleted)
	for (const [recordPath] of syncRecords) {
		const local = localStatsMap.get(recordPath)
		const remote = remoteStatsMap.get(recordPath)

		if (!local && !remote) {
			logDecision('orphaned record → clean', recordPath)
			tasks.push(
				taskFactory.createCleanRecordTask({
					remotePath: recordPath,
					localPath: recordPath,
					remoteBaseDir,
				}),
			)
		}
	}

	// * sync folder: remote -> local
	for (const remote of remoteStatsFiltered) {
		if (!remote.isDir) {
			continue
		}
		const localPath = remotePathToLocalPath(remoteBaseDir, remote.path)
		const local = localStatsMap.get(localPath)
		const record = syncRecords.get(localPath)
		if (local) {
			if (!local.isDir) {
				throw new Error(
					`Folder conflict: remote path ${remote.path} is a folder but local path ${localPath} is a file`,
				)
			}
			if (!record) {
				noopFolderTasks.push(
					taskFactory.createNoopTask({
						localPath: localPath,
						remotePath: remote.path,
						remoteBaseDir,
					}),
				)
			}
		} else if (record) {
			const remoteChanged = hasFolderContentChanged(
				remote.path,
				remoteStatsFiltered,
				syncRecords,
				'remote',
			)

			if (remoteChanged) {
				logDecision('remote folder content changed → mkdir local', localPath)
				mkdirLocalTasks.push(
					taskFactory.createMkdirLocalTask({
						localPath,
						remotePath: remote.path,
						remoteBaseDir,
					}),
				)
				continue
			}

			if (hasIgnoredInFolder(remote.path, remoteStats)) {
				const ignoredPaths = getIgnoredPathsInFolder(remote.path, remoteStats)
				logDecision('skip removing remote folder (contains ignored items)', remote.path)
				tasks.push(
					taskFactory.createSkippedTask({
						localPath,
						remotePath: remote.path,
						remoteBaseDir,
						reason: SkipReason.FolderContainsIgnoredItems,
						ignoredPaths,
					}),
				)
				continue
			}

			logDecision('remote folder removable → remove remote', remote.path)
			removeRemoteFolderTasks.push(
				taskFactory.createRemoveRemoteTask({
					localPath: remote.path,
					remotePath: remote.path,
					remoteBaseDir,
				}),
			)
		} else {
			logDecision('remote folder not in local → mkdir local', localPath)
			mkdirLocalTasks.push(
				taskFactory.createMkdirLocalTask({
					localPath,
					remotePath: remote.path,
					remoteBaseDir,
				}),
			)
		}
	}

	// * sync folder: local -> remote
	for (const local of localStatsFiltered) {
		if (!local.isDir) {
			continue
		}
		const remote = remoteStatsMap.get(local.path)
		const record = syncRecords.get(local.path)
		if (remote) {
			if (!record) {
				noopFolderTasks.push(
					taskFactory.createNoopTask({
						localPath: local.path,
						remotePath: remote.path,
						remoteBaseDir,
					}),
				)
				continue
			}
		} else {
			if (record) {
				const localChanged = hasFolderContentChanged(
					local.path,
					localStatsFiltered,
					syncRecords,
					'local',
				)

				if (localChanged) {
					logDecision('local folder content changed → mkdir remote', local.path)
					if (hasFilenameError(local.path)) {
						tasks.push(
							taskFactory.createFilenameErrorTask({
								localPath: local.path,
								remotePath: local.path,
								remoteBaseDir,
							}),
						)
					} else {
						mkdirRemoteTasks.push(
							taskFactory.createMkdirRemoteTask({
								localPath: local.path,
								remotePath: local.path,
								remoteBaseDir,
							}),
						)
					}
					continue
				}

				if (hasIgnoredInFolder(local.path, localStats)) {
					const ignoredPaths = getIgnoredPathsInFolder(local.path, localStats)
					logDecision('skip removing local folder (contains ignored items)', local.path)
					tasks.push(
						taskFactory.createSkippedTask({
							localPath: local.path,
							remotePath: local.path,
							remoteBaseDir,
							reason: SkipReason.FolderContainsIgnoredItems,
							ignoredPaths,
						}),
					)
					continue
				}

				logDecision('local folder removable → remove local', local.path)
				removeLocalFolderTasks.push(
					taskFactory.createRemoveLocalTask({
						localPath: local.path,
						remotePath: local.path,
						remoteBaseDir,
					}),
				)
				continue
			}

			logDecision('local folder not in remote → mkdir remote', local.path)
			if (hasFilenameError(local.path)) {
				tasks.push(
					taskFactory.createFilenameErrorTask({
						localPath: local.path,
						remotePath: local.path,
						remoteBaseDir,
					}),
				)
			} else {
				mkdirRemoteTasks.push(
					taskFactory.createMkdirRemoteTask({
						localPath: local.path,
						remotePath: local.path,
						remoteBaseDir,
					}),
				)
			}
			continue
		}

		if (!remote.isDir) {
			throw new Error(
				`Folder conflict: local path ${local.path} is a folder but remote path ${remote.path} is a file`,
			)
		}
	}

	// Sort folder tasks to ensure correct execution order
	removeRemoteFolderTasks.sort(
		(a, b) => b.remotePath.length - a.remotePath.length,
	)
	removeLocalFolderTasks.sort((a, b) => b.localPath.length - a.localPath.length)
	const allFolderTasks = [
		...removeRemoteFolderTasks,
		...removeLocalFolderTasks,
		...mkdirLocalTasks,
		...mkdirRemoteTasks,
		...noopFolderTasks,
	]

	tasks.splice(0, 0, ...allFolderTasks)
	return tasks
}

