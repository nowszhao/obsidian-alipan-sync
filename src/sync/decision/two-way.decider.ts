import { isEqual } from 'ohash'
import { blobStore } from '~/storage/blob'
import CleanRecordTask from '../tasks/clean-record.task'
import ConflictResolveTask from '../tasks/conflict-resolve.task'
import FilenameErrorTask from '../tasks/filename-error.task'
import MkdirLocalTask from '../tasks/mkdir-local.task'
import MkdirRemoteTask from '../tasks/mkdir-remote.task'
import NoopTask from '../tasks/noop.task'
import PullTask from '../tasks/pull.task'
import PushTask from '../tasks/push.task'
import RemoveLocalTask from '../tasks/remove-local.task'
import RemoveRemoteTask from '../tasks/remove-remote.task'
import SkippedTask from '../tasks/skipped.task'
import { BaseTask } from '../tasks/task.interface'
import BaseSyncDecider from './base.decider'
import {
	ConflictTaskOptions,
	PullTaskOptions,
	SkippedTaskOptions,
	TaskFactory,
	TaskOptions,
} from './sync-decision.interface'
import { twoWayDecider } from './two-way.decider.function'
import { sha1Hex } from '~/utils/sha256'
import { localFileSha1, CONTENT_HASH_LIMIT } from '~/utils/content-hash'
import { StatModel } from '~/model/stat.model'

export default class TwoWaySyncDecider extends BaseSyncDecider {
	async decide(): Promise<BaseTask[]> {
		const syncRecordStorage = this.getSyncRecordStorage()
		const [records, localStats, remoteStats] = await Promise.all([
			syncRecordStorage.getRecords(),
			this.sync.localFS.walk(),
			this.sync.remoteFs.walk(),
		])

		// 创建共用的task选项
		const commonTaskOptions = {
			remoteStorage: this.remoteStorage,
			vault: this.vault,
			remoteBaseDir: this.remoteBaseDir,
			syncRecord: syncRecordStorage,
			app: this.app,
		}

		// 创建Task工厂
		const taskFactory: TaskFactory = {
			createPullTask: (options: PullTaskOptions) =>
				new PullTask({ ...commonTaskOptions, ...options }),
			createPushTask: (options: TaskOptions) =>
				new PushTask({ ...commonTaskOptions, ...options }),
			createConflictResolveTask: (options: ConflictTaskOptions) =>
				new ConflictResolveTask({ ...commonTaskOptions, ...options }),
			createNoopTask: (options: TaskOptions) =>
				new NoopTask({ ...commonTaskOptions, ...options }),
			createRemoveLocalTask: (options: TaskOptions) =>
				new RemoveLocalTask({ ...commonTaskOptions, ...options }),
			createRemoveRemoteTask: (options: TaskOptions) =>
				new RemoveRemoteTask({ ...commonTaskOptions, ...options }),
			createMkdirLocalTask: (options: TaskOptions) =>
				new MkdirLocalTask({ ...commonTaskOptions, ...options }),
			createMkdirRemoteTask: (options: TaskOptions) =>
				new MkdirRemoteTask({ ...commonTaskOptions, ...options }),
			createCleanRecordTask: (options: TaskOptions) =>
				new CleanRecordTask({ ...commonTaskOptions, ...options }),
			createFilenameErrorTask: (options: TaskOptions) =>
				new FilenameErrorTask({ ...commonTaskOptions, ...options }),
			createSkippedTask: (options: SkippedTaskOptions) =>
				new SkippedTask({ ...commonTaskOptions, ...options }),
		}

		// 文件内容比较函数
		const compareFileContent = async (
			filePath: string,
			baseContent: ArrayBuffer,
		): Promise<boolean> => {
			const file = this.vault.getFileByPath(filePath)
			if (!file) return false
			const currentContent = await this.vault.readBinary(file)
			return isEqual(baseContent, currentContent)
		}
		const getBaseContent = async (key: string): Promise<ArrayBuffer | null> => {
			const blob = await blobStore.get(key)
			if (!blob) {
				return null
			}
			return await blob.arrayBuffer()
		}
		// LOOSE 内容级校验：远端 hash 免费（API），本地懒算（阈值内）
		const sizeOf = (s?: StatModel) => (s && !s.isDir ? s.size : undefined)
		const compareLocalRemote = async (
			local: StatModel,
			remote: StatModel,
		): Promise<boolean | undefined> => {
			if (sizeOf( local) !== sizeOf(remote)) return false       // 双保险
			const file = this.vault.getFileByPath(local.path)
			if (!file) return false
			const localHash = await localFileSha1(this.vault, file,
				this.settings.contentHashLimitMB * 1024 * 1024,
			)  // >1MB 返回 undefined
			if (!localHash) return undefined                   // 大文件降级
			if (remote.contentHash) return localHash === remote.contentHash
			return undefined                                   // 远端无 hash → 退回 size 猜测
		}
		// 调用纯函数进行决策
		return await twoWayDecider({
			settings: {
				skipLargeFiles: this.settings.skipLargeFiles,
				conflictStrategy: this.settings.conflictStrategy,
				useGitStyle: this.settings.useGitStyle,
				syncMode: this.settings.syncMode,
				nonMarkdownConflictStrategy: this.settings.nonMarkdownConflictStrategy,
			},
			localStats,
			remoteStats,
			syncRecords: records,
			remoteBaseDir: this.remoteBaseDir,
			getBaseContent,
			compareFileContent,
			compareLocalRemote,
			taskFactory,
		})
	}
}
