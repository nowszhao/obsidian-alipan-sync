import { isEqual, noop } from 'lodash-es'
import i18n from '~/i18n'
import { StatModel } from '~/model/stat.model'
import { SyncRecordModel } from '~/model/sync-record.model'
import { RemoteBufferLike } from '~/remote-storage/remote-storage.interface'
import { blobStore } from '~/storage/blob'
import { isMergeablePath } from '~/sync/utils/is-mergeable-path'
import logger from '~/utils/logger'
import { mergeDigIn } from '~/utils/merge-dig-in'
import { statVaultItem } from '~/utils/stat-vault-item'
import {
	LatestTimestampResolution,
	resolveByIntelligentMerge,
	resolveByLatestTimestamp,
} from '../core/merge-utils'
import { BaseTask, BaseTaskOptions, toTaskError } from './task.interface'
import ConflictResolveModal from '~/components/ConflictResolveModal'
import { localFileSha1 } from '~/utils/content-hash'
import { useSettings } from '~/settings'   // ← 顶部加

export enum ConflictStrategy {
	DiffMatchPatch = 'diff-match-patch',
	LatestTimeStamp = 'latest-timestamp',
	Skip = 'skip',
}

//非markdown文件冲突解决模式
//export type NonMarkdownConflictStrategy = nonMarkdownConflictStrategyEnum
export enum NonMarkdownConflictStrategy
{ 
	LatestTimeStamp='latest-timestamp',
	manual='manual'
}
export default class ConflictResolveTask extends BaseTask {
	resolvedBySkip = false    
	constructor(
		public readonly options: BaseTaskOptions & {
			record?: SyncRecordModel
			strategy: ConflictStrategy
			remoteStat?: StatModel
			localStat?: StatModel
			useGitStyle: boolean
			nonMarkdownStrategy?: NonMarkdownConflictStrategy
		},
	) {
		super(options)
	}

	async exec() {
		try {
			const local =
				this.options.localStat ??
				(await statVaultItem(this.vault, this.localPath))

			if (!local) {
				throw new Error('Local file not found: ' + this.localPath)
			}

			const remote =
				this.options.remoteStat ??
				(this.remoteStorage
					? await this.remoteStorage.stat(this.remotePath)
					: (() => { throw new Error('Remote storage not available') })())

			if (remote.isDir) {
				throw new Error('Remote path is a directory: ' + this.remotePath)
			}

			if (local.isDir) {
				throw new Error('Local path is a directory: ' + this.localPath)
			}

			if (local.size === 0 && remote.size === 0) {
				return { success: true } as const
			}

			// 非 markdown 冲突 + manual 设置：独立于 conflictStrategy 触发弹窗
			if (!isMergeablePath(this.localPath) || !isMergeablePath(this.remotePath))
			{
				switch(this.options.nonMarkdownStrategy){
					case  NonMarkdownConflictStrategy.manual  :
						return await this.execManualResolve(local, remote)
					case NonMarkdownConflictStrategy.LatestTimeStamp :
						return await this.execLatestTimeStamp(local,remote)
					default:
						// 未设置（undefined）时默认时间戳兜底
						return await this.execLatestTimeStamp(local, remote)
				}
			}else
			{
				
				switch (this.options.strategy) {
					case ConflictStrategy.DiffMatchPatch:
						return await this.execIntelligentMerge()					
					case ConflictStrategy.LatestTimeStamp:
						return await this.execLatestTimeStamp(local, remote)
					case ConflictStrategy.Skip:
						// Skip conflict resolution - keep files as they are
						// Don't update record to preserve conflict state for next sync
						return { success: true, skipRecord: true } as const		
					default:
						// 理论上不可达，兜底
						return await this.execLatestTimeStamp(local, remote)			

				}
			}
		} catch (e) {
			logger.error(this, e)
			return {
				success: false,
				error: toTaskError(e, this),
			}
		}
	}

	async execLatestTimeStamp(local: StatModel, remote: StatModel) {
		try {
			// At this point we know both local and remote are files (not directories)
			// so mtime is guaranteed to exist
			const localMtime = local.mtime!
			const remoteMtime = remote.mtime!

			if (remoteMtime === localMtime) {
				return { success: true } as const
			}

			const file = this.vault.getFileByPath(this.localPath)
			if (!file) {
				return {
					success: false,
					error: toTaskError(
						new Error('cannot find file in local fs: ' + this.localPath),
						this,
					),
				}
			}
			const localContent = await this.vault.readBinary(file)
			let remoteContent: RemoteBufferLike
			if (this.remoteStorage) {
				remoteContent = await this.remoteStorage.getFileContents(this.remotePath)
			} else {
				throw new Error('Remote storage not available')
			}

			const result = resolveByLatestTimestamp({
				localMtime,
				remoteMtime,
				localContent,
				remoteContent,
			})

			switch (result.status) {
				case LatestTimestampResolution.UseRemote:
					const arrayBuffer =
						result.content instanceof ArrayBuffer
							? result.content
							: new Uint8Array(result.content).buffer
					await this.vault.modifyBinary(file, arrayBuffer)
					break
				case LatestTimestampResolution.UseLocal:
					if (this.remoteStorage) {
						await this.remoteStorage.putFileContents(this.remotePath, result.content as RemoteBufferLike, {
							overwrite: true,
						})
					} else {
						throw new Error('Remote storage not available')
					}
					break
				case LatestTimestampResolution.NoChange:
					noop()
					break
			}

			return { success: true } as const
		} catch (e) {
			logger.error(this, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}

	async execIntelligentMerge() {
		try {
			const file = this.vault.getFileByPath(this.localPath)
			if (!file) {
				throw new Error('cannot find file in local fs: ' + this.localPath)
			}
			const localBuffer = await this.vault.readBinary(file)
			let remoteBuffer: RemoteBufferLike
			if (this.remoteStorage) {
				remoteBuffer = await this.remoteStorage.getFileContents(this.remotePath)
			} else {
				throw new Error('Remote storage not available')
			}

			if (isEqual(localBuffer, remoteBuffer)) {
				return { success: true } as const
			}

			const { record } = this.options
			let baseBlob: Blob | null = null
			const baseKey = record?.base?.key
			if (baseKey) {
				baseBlob = await blobStore.get(baseKey)
			}

			const localIsMergeable = isMergeablePath(file.path)
			const remoteIsMergeable = isMergeablePath(this.remotePath)

			if (!(localIsMergeable && remoteIsMergeable)) {
				throw new Error(i18n.t('sync.error.mergeNotSupported'))
			}

			const localText = await new Blob([new Uint8Array(localBuffer)]).text()
			const remoteText = await new Blob([new Uint8Array(remoteBuffer)]).text()
			const baseText = (await baseBlob?.text()) ?? localText

			const mergeResult = await resolveByIntelligentMerge({
				localContentText: localText,
				remoteContentText: remoteText,
				baseContentText: baseText,
			})

			if (!mergeResult.success) {
				// If patch_apply fails to resolve all, use mergeDigIn as a further fallback
				const mergeDigInResult = mergeDigIn(localText, baseText, remoteText, {
					stringSeparator: '\n',
					useGitStyle: this.options.useGitStyle,
				})
				// mergeDigIn itself might produce conflict markers if it can't fully resolve.
				// The task should handle this merged text (which might contain markers).
				const mergedDmpText = mergeDigInResult.result.join('\n')

				let putResult: boolean
				if (this.remoteStorage) {
					putResult = await this.remoteStorage.putFileContents(
						this.remotePath,
						mergedDmpText,
						{ overwrite: true },
					)
				} else {
					throw new Error('Remote storage not available')
				}

				if (putResult) {
					await this.vault.modify(file, mergedDmpText)
					return { success: true } as const
				} else {
					throw new Error(i18n.t('sync.error.failedToUploadMerged'))
				}
			}

			if (mergeResult.isIdentical) {
				// This case should be caught by the isEqual(localBuffer, remoteBuffer) check earlier,
				// but resolveByIntelligentMerge also returns it.
				return { success: true } as const
			}

			const mergedText = mergeResult.mergedText!

			// If mergedText is the same as remoteText, we only need to update localText if it's different.
			if (mergedText === remoteText) {
				if (mergedText !== localText) {
					await this.vault.modify(file, mergedText)
				}
				return { success: true } as const
			}

			// If mergedText is different from remoteText, then both remote and local need to be updated.
			let putResult: boolean
			if (this.remoteStorage) {
				putResult = await this.remoteStorage.putFileContents(
					this.remotePath,
					mergedText,
					{ overwrite: true },
				)
			} else {
				throw new Error('Remote storage not available')
			}

			if (!putResult) {
				throw new Error(i18n.t('sync.error.failedToUploadMerged'))
			}

			if (localText !== mergedText) {
				await this.vault.modify(file, mergedText)
			}

			return { success: true } as const
		} catch (e) {
			logger.error(this, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}



	private async execManualResolve(local: StatModel, remote: StatModel) {
		try {
			const app = this.options.app
			if (!app) {
				// 无 app（异常注入链）兜底：降级时间戳，避免永久失败
				return await this.execLatestTimeStamp(local, remote)
			}
			const { contentHashLimitMB } = await useSettings()
			let localHash: string | undefined
			const localFile = this.vault.getFileByPath(this.localPath)
			const remoteFile = this.vault.getFileByPath(this.remotePath)
			if (localFile && localFile?.stat.size!=remoteFile?.stat.size ) {
				localHash = await localFileSha1(this.vault, localFile,
				contentHashLimitMB*1024*1024,
				)
			}
			// ② 远端 hash：API 免费字段（改动 2 后 StatModel 自带）
			const remoteHash = remote.contentHash

			const choice = await new ConflictResolveModal(
				app, this.localPath, this.remotePath,
				local, remote, localHash, remoteHash,   // ← 追加两个参数
			).open()
						

			const file = this.vault.getFileByPath(this.localPath)
			if (!file) {
				throw new Error('cannot find file in local fs: ' + this.localPath)
			}

			if (choice === 'local') {
				// 保留本地 → push 覆盖远端
				const localContent = await this.vault.readBinary(file)
				if (!this.remoteStorage) {
					throw new Error('Remote storage not available')
				}
				await this.remoteStorage.putFileContents(
					this.remotePath,
					localContent as RemoteBufferLike,
					{ overwrite: true },
				)
				return { success: true } as const
			}


			if (choice === 'remote') {
				// 保留远端 → pull 覆盖本地
				if (!this.remoteStorage) {
					throw new Error('Remote storage not available')
				}
				const remoteContent = await this.remoteStorage.getFileContents(this.remotePath)
				
				const arrayBuffer =
					remoteContent instanceof ArrayBuffer
						? remoteContent
						: new Uint8Array(remoteContent).buffer
				await this.vault.modifyBinary(file, arrayBuffer)
				return { success: true } as const
			}

			// skip：保留冲突状态，不更新记录 → 下次同步继续提示，直到用户决定
			this.resolvedBySkip = true
			return { success: true, skipRecord: true } as const
		} catch (e) {
			logger.error(this, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}
}
