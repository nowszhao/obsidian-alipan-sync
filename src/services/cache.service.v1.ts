import { deflateSync, inflateSync } from 'fflate/browser'
import { Notice } from 'obsidian'
import { join } from 'path-browserify'
import superjson from 'superjson'
import i18n from '~/i18n'
import { StatModel } from '~/model/stat.model'
import { ExportedStorage } from '~/settings/cache'
import { traverseCacheKV } from '~/storage'
import { getTraversalDBKey } from '~/utils/get-db-key'
import logger from '~/utils/logger'
import { uint8ArrayToArrayBuffer } from '~/utils/uint8array-to-arraybuffer'
import type AlipanSyncPlugin from '..'

/**
 * Service for handling cache operations (save, restore, delete, list)
 * Uses RemoteStorage interface for Alipan compatibility.
 */
export default class CacheServiceV1 {
	constructor(
		private plugin: AlipanSyncPlugin,
		private remoteCacheDir: string,
	) {}

	private async getRemoteStorage() {
		const storage = await this.plugin.createRemoteStorage?.()
		if (!storage) {
			throw new Error('Remote storage not available. Please check your account configuration.')
		}
		return storage
	}

	/**
	 * Save the current cache to a file in the remote cache directory
	 */
	async saveCache(filename: string) {
		try {
			const storage = await this.getRemoteStorage()
			const traverseRemoteCache = await traverseCacheKV.get(
				await getTraversalDBKey(
					this.plugin.settings.alipan?.driveId || '',
					this.plugin.remoteBaseDir,
				),
			)

			const exportedStorage: ExportedStorage = {
				traverseRemoteCache: traverseRemoteCache || undefined,
				exportedAt: new Date().toISOString(),
			}

			// Encoding pipeline: superjson.stringify -> deflate level 9
			const serializedStr = superjson.stringify(exportedStorage)
			if (!serializedStr || serializedStr.length === 0) {
				throw new Error('Cache data serialization failed')
			}

			const encoder = new TextEncoder()

			const deflatedStorage = deflateSync(encoder.encode(serializedStr), {
				level: 9,
			}) as Uint8Array<ArrayBuffer>
			const filePath = join(this.remoteCacheDir, filename)

			// Ensure cache directory exists
			const dirExists = await Promise.resolve(storage.exists(this.remoteCacheDir)).catch(() => false)
			if (!dirExists) {
				await storage.createDirectory(this.remoteCacheDir, { recursive: true })
			}

			await storage.putFileContents(
				filePath,
				uint8ArrayToArrayBuffer(deflatedStorage),
				{ overwrite: true },
			)

			new Notice(i18n.t('settings.cache.saveModal.success'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error saving cache:', error)
			new Notice(
				i18n.t('settings.cache.saveModal.error', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Restore the cache from a file in the remote cache directory
	 */
	async restoreCache(filename: string) {
		try {
			const storage = await this.getRemoteStorage()
			const filePath = join(this.remoteCacheDir, filename)

			const fileExists = await Promise.resolve(storage.exists(filePath)).catch(() => false)
			if (!fileExists) {
				new Notice(i18n.t('settings.cache.restoreModal.fileNotFound'))
				return Promise.reject(new Error('File not found'))
			}

			const fileContent = await storage.getFileContents(filePath)

			// Check if file content is empty
			if (!fileContent || (fileContent instanceof ArrayBuffer && fileContent.byteLength === 0)) {
				throw new Error('Cache file is empty')
			}

			// Decoding pipeline: inflate -> superjson.parse
			const inflatedFileContent = inflateSync(new Uint8Array(fileContent as ArrayBuffer))
			if (!inflatedFileContent || inflatedFileContent.length === 0) {
				throw new Error('Inflate failed or resulted in empty content')
			}

			const decoder = new TextDecoder()
			const decodedContent = decoder.decode(inflatedFileContent)
			if (!decodedContent || decodedContent.trim() === '') {
				throw new Error('Cache file content is invalid or empty')
			}

			const exportedStorage: ExportedStorage = superjson.parse(decodedContent)

			// Validate the structure of exported storage
			if (!exportedStorage) {
				throw new Error('Invalid cache file format')
			}
			const { traverseRemoteCache } = exportedStorage
			if (traverseRemoteCache) {
				await traverseCacheKV.set(
					await getTraversalDBKey(
						this.plugin.settings.alipan?.driveId || '',
						this.plugin.remoteBaseDir,
					),
					traverseRemoteCache,
				)
			}
			new Notice(i18n.t('settings.cache.restoreModal.success'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error restoring cache:', error)
			new Notice(
				i18n.t('settings.cache.restoreModal.error', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Delete a cache file from the remote cache directory
	 */
	async deleteCache(filename: string): Promise<void> {
		try {
			const storage = await this.getRemoteStorage()
			const filePath = join(this.remoteCacheDir, filename)

			await storage.deleteFile(filePath)

			new Notice(i18n.t('settings.cache.restoreModal.deleteSuccess'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error deleting cache file:', error)
			new Notice(
				i18n.t('settings.cache.restoreModal.deleteError', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Load the list of cache files from the remote cache directory
	 */
	async loadCacheFileList(): Promise<StatModel[]> {
		try {
			const storage = await this.getRemoteStorage()
			const dirExists = await Promise.resolve(storage.exists(this.remoteCacheDir))
				.catch(() => false)
			if (!dirExists) {
				await storage.createDirectory(this.remoteCacheDir, { recursive: true })
				return []
			}
			const files = await storage.getDirectoryContents(this.remoteCacheDir)
			return files.filter(f => !f.isDir)
		} catch (error) {
			logger.error('Error loading cache file list:', error)
			throw error
		}
	}
}
