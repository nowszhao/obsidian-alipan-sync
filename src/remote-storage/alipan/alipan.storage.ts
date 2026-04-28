/**
 * Alipan (阿里云盘) Remote Storage implementation.
 *
 * Implements the RemoteStorage interface using the Alipan Open Platform API.
 * Key characteristics:
 * 1. Uses file_id instead of path for addressing → handled by AlipanPathResolver
 * 2. File upload is a 3-step process: CreateFile → Upload Parts → CompleteFile
 * 3. Delta responses are JSON with op-based entries
 */

import { dirname, basename } from 'path-browserify'
import { StatModel } from '~/model/stat.model'
import logger from '~/utils/logger'
import RemoteStorage, {
	DeltaResponse,
	DownloadOptions,
	MkdirOptions,
	RemoteBufferLike,
	UploadOptions,
	DeltaEntry,
} from '../remote-storage.interface'
import { AlipanClient } from './alipan.client'
import { AlipanPathResolver } from './alipan-path-resolver'
import { AlipanFile } from './alipan.types'

/**
 * Convert an AlipanFile to StatModel.
 */
function alipanFileToStatModel(file: AlipanFile, path: string): StatModel {
	if (file.type === 'folder') {
		return {
			path,
			basename: file.name,
			isDir: true,
			isDeleted: false,
			mtime: new Date(file.updated_at).getTime(),
		}
	}
	return {
		path,
		basename: file.name,
		isDir: false,
		isDeleted: false,
		mtime: new Date(file.updated_at).getTime(),
		size: file.size ?? 0,
	}
}

/**
 * Convert RemoteBufferLike to ArrayBuffer.
 */
function toArrayBuffer(content: RemoteBufferLike | string): ArrayBuffer {
	if (content instanceof ArrayBuffer) {
		return content
	}
	if (typeof content === 'string') {
		return new TextEncoder().encode(content).buffer as ArrayBuffer
	}
	// Buffer
	if (content instanceof Uint8Array) {
		return content.buffer.slice(
			content.byteOffset,
			content.byteOffset + content.byteLength,
		) as ArrayBuffer
	}
	return content as ArrayBuffer
}

export class AlipanRemoteStorage extends RemoteStorage {
	readonly type = 'alipan'
	private pathResolver: AlipanPathResolver

	constructor(private client: AlipanClient) {
		super()
		this.pathResolver = new AlipanPathResolver(client)
	}

	/**
	 * Access the path resolver for external cache management.
	 */
	get resolver(): AlipanPathResolver {
		return this.pathResolver
	}

	// ========================
	// File Operations
	// ========================

	async putFileContents(
		remotePath: string,
		content: RemoteBufferLike | string,
		options?: UploadOptions,
	): Promise<boolean> {
		try {
			const arrayBuffer = toArrayBuffer(content)
			const fileName = basename(remotePath)
			const parentPath = dirname(remotePath)

			// Ensure parent directory exists and get its file_id
			const parentFileId = await this.pathResolver.resolveOrCreate(parentPath)

			// If overwrite is requested and the file already exists, delete it first
			if (options?.overwrite) {
				const existingFileId = await this.pathResolver.resolve(remotePath)
				if (existingFileId) {
					logger.debug(`Alipan: deleting existing file before overwrite: ${remotePath}`)
					try {
						await this.client.trashFile({
							drive_id: this.client.driveId,
							file_id: existingFileId,
						})
						this.pathResolver.remove(remotePath)
					} catch (deleteErr) {
						// If delete fails (e.g., file was already deleted), log and continue
						logger.debug(`Alipan: failed to delete existing file, proceeding with upload: ${remotePath}`, deleteErr)
					}
				}
			}

			// Step 1: Create file (initialize upload)
			const createResult = await this.client.createFile({
				name: fileName,
				type: 'file',
				parent_file_id: parentFileId,
				drive_id: this.client.driveId,
				size: arrayBuffer.byteLength,
				check_name_mode: options?.overwrite ? 'refuse' : 'auto_rename',
				part_info_list: [{ part_number: 1 }],
			})

			// If rapid upload succeeded, no need to actually upload
			if (createResult.rapid_upload) {
				this.pathResolver.set(remotePath, createResult.file_id)
				return true
			}

			// Step 2: Upload content to the upload URL
			if (
				createResult.part_info_list &&
				createResult.part_info_list.length > 0
			) {
				const uploadUrl = createResult.part_info_list[0].upload_url
				if (uploadUrl) {
					await this.client.uploadPartContent(uploadUrl, arrayBuffer)
				} else {
					logger.error(`Alipan: no upload_url in createFile response for ${remotePath}`)
					throw new Error(`No upload URL provided by Alipan API for ${remotePath}`)
				}
			} else if (!createResult.rapid_upload && createResult.upload_id) {
				// createFile returned upload_id but no part_info_list — this shouldn't happen
				logger.error(`Alipan: createFile returned upload_id but no part_info_list for ${remotePath}`)
				throw new Error(`Unexpected createFile response: upload_id without part_info_list for ${remotePath}`)
			}

			// Step 3: Complete the upload
			if (createResult.upload_id) {
				await this.client.completeFile({
					drive_id: this.client.driveId,
					file_id: createResult.file_id,
					upload_id: createResult.upload_id,
				})
			}

			// Update path resolver cache
			this.pathResolver.set(remotePath, createResult.file_id)

			return true
		} catch (e) {
			logger.error(`Alipan putFileContents error: ${remotePath}`, e)
			throw e
		}
	}

	async getFileContents(
		remotePath: string,
		_options?: DownloadOptions,
	): Promise<RemoteBufferLike> {
		// Retry once if the cached file_id points to a trashed file.
		// This happens in multi-device sync: device A overwrote the file
		// (old file_id → trash, new file_id created), but device B still
		// has the old file_id in its resolver cache.
		const maxAttempts = 2
		let lastError: unknown

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const fileId = await this.pathResolver.resolve(remotePath)
				if (!fileId) {
					throw new Error(`File not found: ${remotePath}`)
				}

				// Get download URL
				const downloadResult = await this.client.getDownloadUrl({
					drive_id: this.client.driveId,
					file_id: fileId,
				})

				// Download the file
				return await this.client.downloadFromUrl(downloadResult.url)
			} catch (e) {
				lastError = e
				const isRecycleBinError =
					e instanceof Error &&
					e.message.includes('ForbiddenFileInTheRecycleBin')

				if (isRecycleBinError && attempt < maxAttempts) {
					// Stale cache detected — evict and re-resolve by walking
					// the parent directory, which will pick up the new file_id.
					logger.warn(
						`Alipan: stale file_id points to recycle bin, refreshing cache and retrying: ${remotePath}`,
					)
					this.pathResolver.remove(remotePath)
					// Force re-resolution by listing the parent directory,
					// which updates resolver with the current (non-trashed) file_id.
					await this.refreshFileIdFromParent(remotePath)
					continue
				}

				// Final failure — clean cache so future syncs don't hit the same stale id
				if (isRecycleBinError) {
					this.pathResolver.remove(remotePath)
				}
				logger.error('Alipan getFileContents error:', e)
				throw e
			}
		}

		// Unreachable, but TypeScript needs it
		throw lastError instanceof Error
			? lastError
			: new Error(`Failed to get file contents: ${remotePath}`)
	}

	/**
	 * Re-list the parent directory to refresh the cached file_id for remotePath.
	 * Used when the cached file_id is stale (e.g. points to a trashed file
	 * because another device overwrote the file).
	 */
	private async refreshFileIdFromParent(remotePath: string): Promise<void> {
		try {
			const parentPath = dirname(remotePath)
			const fileName = basename(remotePath)
			const parentFileId = await this.pathResolver.resolve(parentPath)
			if (!parentFileId) {
				return
			}

			let marker = ''
			do {
				const result = await this.client.listFile({
					drive_id: this.client.driveId,
					parent_file_id: parentFileId,
					limit: 100,
					marker: marker || undefined,
				})
				for (const item of result.items) {
					if (item.trashed) continue
					if (item.name === fileName) {
						this.pathResolver.set(remotePath, item.file_id)
						return
					}
				}
				marker = result.next_marker
			} while (marker)
		} catch (e) {
			logger.debug(
				`Alipan: refreshFileIdFromParent failed for ${remotePath}`,
				e,
			)
		}
	}

	async deleteFile(remotePath: string): Promise<void> {
		try {
			const fileId = await this.pathResolver.resolve(remotePath)
			if (!fileId) {
				logger.debug(`Alipan deleteFile: not found, skipping: ${remotePath}`)
				return
			}

			await this.client.trashFile({
				drive_id: this.client.driveId,
				file_id: fileId,
			})

			// Clean up path resolver
			this.pathResolver.removeRecursive(remotePath)
		} catch (e) {
			logger.error('Alipan deleteFile error:', e)
			throw e
		}
	}

	async stat(remotePath: string): Promise<StatModel> {
		const fileId = await this.pathResolver.resolve(remotePath)
		if (!fileId) {
			throw new Error(`File not found: ${remotePath}`)
		}

		try {
			const file = await this.client.getFile({
				drive_id: this.client.driveId,
				file_id: fileId,
			})

			// File exists but has been moved to recycle bin by another device.
			// Treat it as "not found" and refresh cache so callers can re-resolve.
			if (file.trashed) {
				logger.warn(
					`Alipan stat: file is in recycle bin, refreshing cache: ${remotePath}`,
				)
				this.pathResolver.remove(remotePath)
				await this.refreshFileIdFromParent(remotePath)
				const newFileId = this.pathResolver.getFileId(remotePath)
				if (newFileId) {
					const refreshed = await this.client.getFile({
						drive_id: this.client.driveId,
						file_id: newFileId,
					})
					return alipanFileToStatModel(refreshed, remotePath)
				}
				throw new Error(`File not found (was in recycle bin): ${remotePath}`)
			}

			return alipanFileToStatModel(file, remotePath)
		} catch (e) {
			if (
				e instanceof Error &&
				e.message.includes('ForbiddenFileInTheRecycleBin')
			) {
				logger.warn(
					`Alipan stat: stale file_id → recycle bin, refreshing: ${remotePath}`,
				)
				this.pathResolver.remove(remotePath)
				await this.refreshFileIdFromParent(remotePath)
				const newFileId = this.pathResolver.getFileId(remotePath)
				if (newFileId) {
					const refreshed = await this.client.getFile({
						drive_id: this.client.driveId,
						file_id: newFileId,
					})
					return alipanFileToStatModel(refreshed, remotePath)
				}
			}
			throw e
		}
	}

	// ========================
	// Directory Operations
	// ========================

	async createDirectory(
		remotePath: string,
		options?: MkdirOptions,
	): Promise<void> {
		if (options?.recursive) {
			// resolveOrCreate handles recursive directory creation
			await this.pathResolver.resolveOrCreate(remotePath)
			return
		}

		const fileName = basename(remotePath)
		const parentPath = dirname(remotePath)
		const parentFileId = await this.pathResolver.resolve(parentPath)
		if (!parentFileId) {
			throw new Error(`Parent directory not found: ${parentPath}`)
		}

		const result = await this.client.createFile({
			name: fileName,
			type: 'folder',
			parent_file_id: parentFileId,
			drive_id: this.client.driveId,
			check_name_mode: 'auto_rename',
		})

		this.pathResolver.set(remotePath, result.file_id)
	}

	async exists(remotePath: string): Promise<boolean> {
		const fileId = await this.pathResolver.resolve(remotePath)
		if (!fileId) {
			return false
		}

		try {
			await this.client.getFile({
				drive_id: this.client.driveId,
				file_id: fileId,
			})
			return true
		} catch {
			return false
		}
	}

	// ========================
	// Delta / Incremental Sync
	// ========================

	async getLatestDeltaCursor(folderName: string): Promise<string> {
		// For Alipan, folderName maps to sync_root_id or we use drive_id directly
		const syncRootId = await this.resolveSyncRootId(folderName)
		const result = await this.client.getLastCursor({
			drive_id: this.client.driveId,
			sync_root_id: syncRootId,
		})
		return result.cursor
	}

	async getDelta(
		folderName: string,
		cursor: string,
	): Promise<DeltaResponse> {
		const syncRootId = await this.resolveSyncRootId(folderName)
		const result = await this.client.listDelta({
			drive_id: this.client.driveId,
			sync_root_id: syncRootId,
			cursor: cursor || undefined,
			limit: 100,
		})

		// Convert Alipan delta items to our unified DeltaEntry format
		const entries: DeltaEntry[] = []
		for (const item of result.items) {
			const isDeleted = ['delete', 'trash'].includes(item.op)
			const file = item.file

			// Build path from file info
			let path: string
			try {
				path = await this.pathResolver.buildPathFromFile(
					file.file_id,
					file.name,
					file.parent_file_id,
				)
			} catch {
				path = '/' + file.name
			}

			entries.push({
				path,
				size: file.size ?? 0,
				isDeleted,
				isDir: file.type === 'folder',
				modified: file.updated_at,
			})

			// Update path resolver cache
			if (!isDeleted) {
				this.pathResolver.set(path, file.file_id)
			} else {
				this.pathResolver.removeRecursive(path)
			}
		}

		return {
			reset: false, // Alipan API doesn't have a reset concept for deltas
			cursor: result.cursor,
			hasMore: result.has_more,
			entries,
		}
	}

	// ========================
	// Directory Listing
	// ========================

	async getDirectoryContents(remotePath: string): Promise<StatModel[]> {
		const fileId = await this.pathResolver.resolve(remotePath)
		if (!fileId) {
			throw new Error(`Directory not found: ${remotePath}`)
		}

		const stats: StatModel[] = []
		let marker = ''

		do {
			const result = await this.client.listFile({
				drive_id: this.client.driveId,
				parent_file_id: fileId,
				limit: 100,
				marker: marker || undefined,
				order_by: 'name',
				order_direction: 'ASC',
			})

			for (const item of result.items) {
				// Skip files that are in the recycle bin
				if (item.trashed) {
					logger.debug(`Alipan: skipping trashed item: ${item.name} (file_id=${item.file_id})`)
					continue
				}

				const itemPath = remotePath === '/'
					? '/' + item.name
					: remotePath + '/' + item.name

				// Update path resolver
				this.pathResolver.set(itemPath, item.file_id)

				stats.push(alipanFileToStatModel(item, itemPath))
			}

			marker = result.next_marker
		} while (marker)

		return stats
	}

	// ========================
	// Helper
	// ========================

	/**
	 * Resolve folderName to sync_root_id for delta operations.
	 * If the folder exists in the resolver, use its file_id.
	 * Otherwise, try to resolve it.
	 */
	private async resolveSyncRootId(
		folderName: string,
	): Promise<string | undefined> {
		if (!folderName || folderName === '/') {
			return undefined // Use drive root
		}
		const path = folderName.startsWith('/') ? folderName : '/' + folderName
		const fileId = await this.pathResolver.resolve(path)
		return fileId ?? undefined
	}
}
