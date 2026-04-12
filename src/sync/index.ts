import { chunk } from 'lodash-es'
import { Notice, Platform, Vault, moment, normalizePath } from 'obsidian'
import { dirname } from 'path-browserify'
import { Subscription } from 'rxjs'
import DeleteConfirmModal from '~/components/DeleteConfirmModal'
import FailedTasksModal, { FailedTaskInfo } from '~/components/FailedTasksModal'
import TaskListConfirmModal from '~/components/TaskListConfirmModal'
import {
	emitEndSync,
	emitPreparingSync,
	emitStartSync,
	emitSyncError,
	emitSyncProgress,
	onCancelSync,
} from '~/events'
import IFileSystem from '~/fs/fs.interface'
import { LocalVaultFileSystem } from '~/fs/local-vault'
import { RemoteStorageFileSystem } from '~/fs/remote-storage'
import i18n from '~/i18n'
import type RemoteStorage from '~/remote-storage/remote-storage.interface'
import { syncRecordKV } from '~/storage'
import { SyncRecord } from '~/storage/sync-record'
import breakableSleep from '~/utils/breakable-sleep'
import { getDBKey } from '~/utils/get-db-key'
import getTaskName from '~/utils/get-task-name'
import { is503Error } from '~/utils/is-503-error'
import { syncLogger } from '~/utils/logger'
import { statVaultItem } from '~/utils/stat-vault-item'
import { stdRemotePath } from '~/utils/std-remote-path'
import AlipanSyncPlugin from '..'
import TwoWaySyncDecider from './decision/two-way.decider'
import CleanRecordTask from './tasks/clean-record.task'
import MkdirRemoteTask from './tasks/mkdir-remote.task'
import NoopTask from './tasks/noop.task'
import PushTask from './tasks/push.task'
import RemoveLocalTask from './tasks/remove-local.task'
import RemoveRemoteTask from './tasks/remove-remote.task'
import SkippedTask from './tasks/skipped.task'
import { BaseTask, TaskError, TaskResult } from './tasks/task.interface'
import { mergeMkdirTasks } from './utils/merge-mkdir-tasks'
import { mergeRemoveRemoteTasks } from './utils/merge-remove-remote-tasks'
import { updateMtimeInRecord as updateMtimeInRecordUtil } from './utils/update-records'

export enum SyncStartMode {
	MANUAL_SYNC = 'manual_sync',
	AUTO_SYNC = 'auto_sync',
}

export interface SyncOptions {
	vault: Vault
	remoteBaseDir: string
	/** Unified remote storage backend */
	remoteStorage: RemoteStorage
}

export class AlipanSync {
	remoteFs: IFileSystem
	localFS: IFileSystem
	isCancelled: boolean = false

	private subscriptions: Subscription[] = []
	private _remoteStorage: RemoteStorage

	constructor(
		private plugin: AlipanSyncPlugin,
		private options: SyncOptions,
	) {
		this.options = Object.freeze(this.options)
		this._remoteStorage = this.options.remoteStorage

		this.remoteFs = new RemoteStorageFileSystem({
			vault: this.options.vault,
			remoteStorage: this._remoteStorage,
			remoteBaseDir: this.options.remoteBaseDir,
		})

		this.localFS = new LocalVaultFileSystem({
			vault: this.options.vault,
			syncRecord: new SyncRecord(
				getDBKey(this.vault.getName(), this.remoteBaseDir),
				syncRecordKV,
			),
		})
		this.subscriptions.push(
			onCancelSync().subscribe(() => {
				this.isCancelled = true
			}),
		)
	}

	async start({ mode }: { mode: SyncStartMode }) {
		try {
			const showNotice = mode === SyncStartMode.MANUAL_SYNC
			emitPreparingSync({ showNotice })
			syncLogger.startSync()

			const settings = this.settings
			const storage = this._remoteStorage
			const remoteBaseDir = stdRemotePath(this.options.remoteBaseDir)
			const syncRecord = new SyncRecord(
				getDBKey(this.vault.getName(), this.remoteBaseDir),
				syncRecordKV,
			)

			let remoteBaseDirExits = await storage.exists(remoteBaseDir)

			if (!remoteBaseDirExits) {
				await syncRecord.drop()
			}

			while (!remoteBaseDirExits) {
				if (this.isCancelled) {
					emitSyncError(new Error(i18n.t('sync.cancelled')))
					return
				}
				try {
					await storage.createDirectory(this.options.remoteBaseDir, {
						recursive: true,
					})
					break
				} catch (e) {
					if (is503Error(e)) {
						await this.handle503Error(60000)
						if (this.isCancelled) {
							emitSyncError(new Error(i18n.t('sync.cancelled')))
							return
						}
						remoteBaseDirExits = await storage.exists(remoteBaseDir)
					} else {
						throw e
					}
				}
			}

			const tasks = await new TwoWaySyncDecider(this, syncRecord).decide()

			// Log decision summary
			const decisionSummary: Record<string, number> = {}
			for (const t of tasks) {
				const name = getTaskName(t)
				decisionSummary[name] = (decisionSummary[name] || 0) + 1
			}
			syncLogger.logDecisionSummary(decisionSummary)

			if (tasks.length === 0) {
				emitEndSync({ showNotice, failedCount: 0 })
				return
			}

			const noopTasks = tasks.filter((t) => t instanceof NoopTask)
			const skippedTasks = tasks.filter((t) => t instanceof SkippedTask)
			let confirmedTasks = tasks.filter(
				(t) => !(t instanceof NoopTask || t instanceof SkippedTask),
			)

			const firstTaskIdxNeedingConfirmation = confirmedTasks.findIndex(
				(t) => !(t instanceof CleanRecordTask),
			)

			if (this.isCancelled) {
				emitSyncError(new Error(i18n.t('sync.cancelled')))
				return
			}

			if (
				showNotice &&
				settings.confirmBeforeSync &&
				firstTaskIdxNeedingConfirmation > -1
			) {
				const allTasksBefore = confirmedTasks
				const confirmExec = await new TaskListConfirmModal(
					this.app,
					confirmedTasks,
				).open()
				if (confirmExec.confirm) {
					confirmedTasks = confirmExec.tasks

					// Convert unchecked RemoveLocalTasks to PushTask/MkdirRemoteTask
					// so they get re-uploaded instead of being silently skipped
					const selectedTaskSet = new Set(confirmExec.tasks)
					const uncheckedRemoveLocalTasks = allTasksBefore.filter(
						(t) =>
							t instanceof RemoveLocalTask &&
							!selectedTaskSet.has(t),
					) as RemoveLocalTask[]

					if (uncheckedRemoveLocalTasks.length > 0) {
						const reuploadResult =
							await this.convertRemoveLocalToReupload(
								uncheckedRemoveLocalTasks,
								tasks,
								confirmedTasks,
								storage,
								syncRecord,
							)
						confirmedTasks = [
							...reuploadResult.mkdirTasks,
							...confirmedTasks,
							...reuploadResult.pushTasks,
						]
					}
				} else {
					emitSyncError(new Error(i18n.t('sync.cancelled')))
					return
				}
			}

		// Check for RemoveLocalTask during auto-sync and ask for confirmation
		if (mode === SyncStartMode.AUTO_SYNC && settings.confirmBeforeDeleteInAutoSync) {
				const removeLocalTasks = confirmedTasks.filter(
					(t) => t instanceof RemoveLocalTask,
				) as RemoveLocalTask[]
				if (removeLocalTasks.length > 0) {
					new Notice(i18n.t('deleteConfirm.warningNotice'), 3000)
					const { tasksToDelete, tasksToReupload } =
						await new DeleteConfirmModal(this.app, removeLocalTasks).open()

					// Convert reupload tasks
					const reuploadResult =
						await this.convertRemoveLocalToReupload(
							tasksToReupload,
							tasks,
							confirmedTasks,
							storage,
							syncRecord,
						)

					// Create set of tasks to delete
					const deleteTaskSet = new Set(tasksToDelete)

					// Remove parent directory delete tasks for reupload files
					// If we reupload /a/b/c/file.png, we shouldn't delete /a, /a/b, or /a/b/c
					for (const reuploadTask of tasksToReupload) {
						let currentPath = normalizePath(reuploadTask.localPath)
						while (
							currentPath &&
							currentPath !== '.' &&
							currentPath !== '' &&
							currentPath !== '/'
						) {
							currentPath = normalizePath(dirname(currentPath))
							if (
								currentPath === '.' ||
								currentPath === '' ||
								currentPath === '/'
							) {
								break
							}
							for (const deleteTask of deleteTaskSet) {
								if (deleteTask.localPath === currentPath) {
									deleteTaskSet.delete(deleteTask)
									break
								}
							}
						}
					}

					// Replace task list, putting mkdir tasks first
					const otherTasks: BaseTask[] = []
					const deleteTasks: RemoveLocalTask[] = []

					for (const t of confirmedTasks) {
						if (!(t instanceof RemoveLocalTask)) {
							otherTasks.push(t)
							continue
						}
						if (deleteTaskSet.has(t)) {
							deleteTasks.push(t)
							continue
						}
					}

					// Reassemble task list: mkdir → other tasks → push → delete
					confirmedTasks = [
						...reuploadResult.mkdirTasks,
						...otherTasks,
						...reuploadResult.pushTasks,
						...deleteTasks,
					]
				}
			}

			const confirmedTasksUniq = Array.from(
				new Set([...confirmedTasks, ...noopTasks, ...skippedTasks]),
			)

			// Merge mkdir tasks with parent-child relationships to reduce API calls
			const mkdirTasks = confirmedTasksUniq.filter(
				(t) => t instanceof MkdirRemoteTask,
			)
			const removeRemoteTasks = confirmedTasksUniq.filter(
				(t) => t instanceof RemoveRemoteTask,
			)
			const otherTasks = confirmedTasksUniq.filter(
				(t) => !(t instanceof MkdirRemoteTask || t instanceof RemoveRemoteTask),
			)
			const mergedMkdirTasks = mergeMkdirTasks(mkdirTasks)
			const mergedRemoveRemoteTasks = mergeRemoveRemoteTasks(removeRemoteTasks)
			const optimizedTasks = [
				...mergedRemoveRemoteTasks,
				...mergedMkdirTasks,
				...otherTasks,
			]

			if (confirmedTasks.length > 500 && Platform.isDesktopApp) {
				new Notice(i18n.t('sync.suggestUseClientForManyTasks'), 5000)
			}

			const hasSubstantialTask = optimizedTasks.some(
				(task) =>
					!(
						task instanceof NoopTask ||
						task instanceof CleanRecordTask ||
						task instanceof SkippedTask
					),
			)
			if (showNotice && hasSubstantialTask) {
				this.plugin.progressService.showProgressModal()
			}

			// Emit start sync event after all confirmations are done
			emitStartSync({ showNotice })

			const chunkSize = 200
			const taskChunks = chunk(optimizedTasks, chunkSize)
			const allTasksResult: TaskResult[] = []

			const totalDisplayableTasks = optimizedTasks.filter(
				(t) => !(t instanceof NoopTask || t instanceof CleanRecordTask),
			)

			// Track all completed tasks across all chunks
			const allCompletedTasks: BaseTask[] = []

			for (const taskChunk of taskChunks) {
				const chunkResult = await this.execTasks(
					taskChunk,
					totalDisplayableTasks,
					allCompletedTasks,
				)
				allTasksResult.push(...chunkResult)
				await this.updateMtimeInRecord(taskChunk, chunkResult)

				if (this.isCancelled) {
					break
				}
			}

			const failedCount = allTasksResult.filter((r) => !r.success).length

			if (mode === SyncStartMode.MANUAL_SYNC && failedCount > 0) {
				const failedTasksInfo: FailedTaskInfo[] = []
				for (let i = 0; i < allTasksResult.length; i++) {
					const result = allTasksResult[i]
					if (!result.success && result.error) {
						const task = result.error.task
						failedTasksInfo.push({
							taskName: getTaskName(task),
							localPath: task.options.localPath,
							errorMessage: result.error.message,
						})
					}
				}
				new FailedTasksModal(this.app, failedTasksInfo).open()
			}

			syncLogger.endSync(failedCount)
			emitEndSync({ failedCount, showNotice })
		} catch (error) {
			emitSyncError(error)
			syncLogger.phaseError('Sync', error)
		} finally {
			this.subscriptions.forEach((sub) => sub.unsubscribe())
		}
	}

	private async execTasks(
		tasks: BaseTask[],
		totalDisplayableTasks: BaseTask[],
		allCompletedTasks: BaseTask[],
	) {
		const res: TaskResult[] = []
		// Filter out NoopTask and CleanRecordTask from total count for progress display
		const tasksToDisplay = tasks.filter(
			(t) => !(t instanceof NoopTask || t instanceof CleanRecordTask),
		)

		syncLogger.startPhase('Execute tasks', `${tasksToDisplay.length} substantive / ${tasks.length} total`)

		for (let i = 0; i < tasks.length; ++i) {
			const task = tasks[i]
			if (this.isCancelled) {
				emitSyncError(new TaskError(i18n.t('sync.cancelled'), task))
				break
			}

			const taskName = getTaskName(task)
			const isSubstantial = !(task instanceof NoopTask || task instanceof CleanRecordTask || task instanceof SkippedTask)

			if (isSubstantial) {
				syncLogger.logTaskStart(allCompletedTasks.length + 1, totalDisplayableTasks.length, taskName, task.localPath)
			}

			const taskStart = Date.now()
			const taskResult = await this.executeWithRetry(task)
			const taskElapsed = Date.now() - taskStart

			if (isSubstantial) {
				const errorMsg = !taskResult.success ? taskResult.error?.message : undefined
				syncLogger.logTaskResult(
					allCompletedTasks.length + 1,
					totalDisplayableTasks.length,
					taskName,
					task.localPath,
					taskResult.success,
					taskElapsed,
					errorMsg,
				)
			}

			res[i] = taskResult
			// Only add substantial tasks to completed list for progress display
			if (!(task instanceof NoopTask || task instanceof CleanRecordTask)) {
				allCompletedTasks.push(task)
				emitSyncProgress(totalDisplayableTasks.length, allCompletedTasks)
			}
		}

		const successCount = res.filter((r) => r.success).length
		const failedCount = tasks.length - successCount
		syncLogger.endPhase('Execute tasks', `${successCount} succeeded, ${failedCount} failed`)

		return res
	}

	/**
	 * Automatically handle 503 errors and retry task execution
	 */
	private async executeWithRetry(task: BaseTask): Promise<TaskResult> {
		while (true) {
			if (this.isCancelled) {
				return {
					success: false,
					error: new TaskError(i18n.t('sync.cancelled'), task),
				}
			}
			const taskResult = await task.exec()
			if (!taskResult.success && is503Error(taskResult.error)) {
				await this.handle503Error(60000)
				if (this.isCancelled) {
					return {
						success: false,
						error: new TaskError(i18n.t('sync.cancelled'), task),
					}
				}
				continue
			}
			return taskResult
		}
	}

	async updateMtimeInRecord(tasks: BaseTask[], results: TaskResult[]) {
		return updateMtimeInRecordUtil(
			this.plugin,
			this.vault,
			this.remoteBaseDir,
			tasks,
			results,
			10,
			this._remoteStorage,
		)
	}

	private async handle503Error(waitMs: number) {
		const now = Date.now()
		const startAt = now + waitMs
		new Notice(
			i18n.t('sync.requestsTooFrequent', {
				time: moment(startAt).format('HH:mm:ss'),
			}),
		)
		await breakableSleep(onCancelSync(), startAt - now)
	}

	get app() {
		return this.plugin.app
	}

	get remoteStorage(): RemoteStorage {
		return this._remoteStorage
	}

	get vault() {
		return this.options.vault
	}

	get remoteBaseDir() {
		return this.options.remoteBaseDir
	}

	get settings() {
		return this.plugin.settings
	}

	/**
	 * Convert RemoveLocalTask[] into PushTask/MkdirRemoteTask for re-uploading,
	 * including ensuring parent directories exist on remote.
	 */
	private async convertRemoveLocalToReupload(
		tasksToReupload: RemoveLocalTask[],
		allOriginalTasks: BaseTask[],
		currentConfirmedTasks: BaseTask[],
		storage: RemoteStorage,
		syncRecord: SyncRecord,
	): Promise<{ mkdirTasks: MkdirRemoteTask[]; pushTasks: PushTask[] }> {
		const mkdirTasksMap = new Map<string, MkdirRemoteTask>()
		const pushTasks: PushTask[] = []
		const remoteExistsCache = new Set<string>()

		const markPathAndParentsAsExisting = (remotePath: string) => {
			let current = remotePath
			while (
				current &&
				current !== '.' &&
				current !== '' &&
				current !== '/'
			) {
				if (remoteExistsCache.has(current)) break
				remoteExistsCache.add(current)
				current = stdRemotePath(dirname(current))
			}
		}

		const ensureParentDir = async (
			localPath: string,
			remotePath: string,
		) => {
			const parentLocalPath = normalizePath(dirname(localPath))
			const parentRemotePath = stdRemotePath(dirname(remotePath))

			if (
				parentLocalPath === '.' ||
				parentLocalPath === '' ||
				parentLocalPath === '/'
			) {
				return
			}

			if (mkdirTasksMap.has(parentRemotePath)) return

			const existsInOriginalTasks = allOriginalTasks.some(
				(t) =>
					t instanceof MkdirRemoteTask &&
					t.remotePath === parentRemotePath,
			)
			if (existsInOriginalTasks) return

			const existsInConfirmedTasks = currentConfirmedTasks.some(
				(t) =>
					t instanceof MkdirRemoteTask &&
					t.remotePath === parentRemotePath,
			)
			if (existsInConfirmedTasks) return

			if (remoteExistsCache.has(parentRemotePath)) return

			try {
				await storage.stat(parentRemotePath)
				markPathAndParentsAsExisting(parentRemotePath)
			} catch {
				const mkdirTask = new MkdirRemoteTask({
					vault: this.vault,
					remoteStorage: storage,
					remoteBaseDir: this.remoteBaseDir,
					remotePath: parentRemotePath,
					localPath: parentLocalPath,
					syncRecord: syncRecord,
				})
				mkdirTasksMap.set(parentRemotePath, mkdirTask)
			}
		}

		for (const task of tasksToReupload) {
			const stat = await statVaultItem(this.vault, task.localPath)
			if (!stat) continue

			await ensureParentDir(task.localPath, task.remotePath)

			if (stat.isDir) {
				const mkdirTask = new MkdirRemoteTask(task.options)
				mkdirTasksMap.set(task.remotePath, mkdirTask)
			} else {
				const pushTask = new PushTask(task.options)
				pushTasks.push(pushTask)
			}
		}

		return {
			mkdirTasks: Array.from(mkdirTasksMap.values()),
			pushTasks,
		}
	}
}

