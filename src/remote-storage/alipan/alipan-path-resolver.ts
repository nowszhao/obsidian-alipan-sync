/**
 * Alipan Path-to-FileID Resolver.
 *
 * 阿里云盘使用 file_id 寻址而非路径寻址，这是与基于路径寻址的存储协议最大的区别。
 * 此模块维护一个 path ↔ file_id 的双向映射缓存，支持：
 * - 通过路径查找 file_id
 * - 通过 file_id 查找路径
 * - 按需走 API 解析路径（当缓存未命中时）
 * - 缓存持久化
 */

import { AlipanClient } from './alipan.client'
import logger from '~/utils/logger'

export class AlipanPathResolver {
	/** path -> file_id */
	private pathToId = new Map<string, string>()
	/** file_id -> path */
	private idToPath = new Map<string, string>()

	constructor(private client: AlipanClient) {
		// Root directory is always 'root'
		this.set('/', 'root')
	}

	/**
	 * Normalize a path for consistent lookup.
	 */
	private normalizePath(p: string): string {
		if (!p.startsWith('/')) {
			p = '/' + p
		}
		// Remove trailing slash (except for root)
		if (p !== '/' && p.endsWith('/')) {
			p = p.slice(0, -1)
		}
		return p
	}

	/**
	 * Set a path ↔ file_id mapping.
	 */
	set(path: string, fileId: string): void {
		path = this.normalizePath(path)
		this.pathToId.set(path, fileId)
		this.idToPath.set(fileId, path)
	}

	/**
	 * Remove a path mapping.
	 */
	remove(path: string): void {
		path = this.normalizePath(path)
		const fileId = this.pathToId.get(path)
		if (fileId) {
			this.idToPath.delete(fileId)
		}
		this.pathToId.delete(path)
	}

	/**
	 * Remove all mappings under a given path (recursive).
	 */
	removeRecursive(path: string): void {
		path = this.normalizePath(path)
		const prefix = path === '/' ? '/' : path + '/'
		const keysToRemove: string[] = []
		for (const [p, id] of this.pathToId) {
			if (p === path || p.startsWith(prefix)) {
				keysToRemove.push(p)
				this.idToPath.delete(id)
			}
		}
		for (const k of keysToRemove) {
			this.pathToId.delete(k)
		}
	}

	/**
	 * Get file_id from cache.
	 */
	getFileId(path: string): string | undefined {
		return this.pathToId.get(this.normalizePath(path))
	}

	/**
	 * Get path from cache.
	 */
	getPath(fileId: string): string | undefined {
		return this.idToPath.get(fileId)
	}

	/**
	 * Resolve a path to file_id, walking the API if necessary.
	 * Walks each segment of the path from the cache boundary.
	 */
	async resolve(path: string): Promise<string | null> {
		path = this.normalizePath(path)

		// Check cache first
		const cached = this.pathToId.get(path)
		if (cached) {
			return cached
		}

		// Walk path segments from root
		const segments = path.split('/').filter(Boolean)
		let currentPath = ''
		let currentFileId = 'root'

		for (const segment of segments) {
			currentPath += '/' + segment
			const normalizedCurrent = this.normalizePath(currentPath)

			// Check cache for this level
			const cachedId = this.pathToId.get(normalizedCurrent)
			if (cachedId) {
				currentFileId = cachedId
				continue
			}

			// Need to query the API: list parent and find the child
			try {
				const found = await this.findChildByName(
					currentFileId,
					segment,
				)
				if (!found) {
					return null
				}
				currentFileId = found
				this.set(normalizedCurrent, currentFileId)
			} catch (e) {
				logger.error(`Alipan PathResolver: error resolving ${normalizedCurrent}`, e)
				return null
			}
		}

		return currentFileId
	}

	/**
	 * Resolve a path, creating directories if they don't exist.
	 * Returns the file_id of the last segment.
	 */
	async resolveOrCreate(
		path: string,
		options?: { isFile?: boolean },
	): Promise<string> {
		path = this.normalizePath(path)
		const segments = path.split('/').filter(Boolean)

		let currentPath = ''
		let currentFileId = 'root'

		const lastIndex = segments.length - 1
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i]
			const isLast = i === lastIndex
			currentPath += '/' + segment
			const normalizedCurrent = this.normalizePath(currentPath)

			// Check cache
			const cachedId = this.pathToId.get(normalizedCurrent)
			if (cachedId) {
				currentFileId = cachedId
				continue
			}

			// Try finding
			const found = await this.findChildByName(currentFileId, segment)
			if (found) {
				currentFileId = found
				this.set(normalizedCurrent, currentFileId)
				continue
			}

			// Create directory (or skip if it's the last segment and it's a file)
			if (isLast && options?.isFile) {
				// Don't create the file here, just return parent
				return currentFileId
			}

			// Create folder
			const createResult = await this.client.createFile({
				name: segment,
				type: 'folder',
				parent_file_id: currentFileId,
				drive_id: this.client.driveId,
				check_name_mode: 'auto_rename',
			})
			currentFileId = createResult.file_id
			this.set(normalizedCurrent, currentFileId)
		}

		return currentFileId
	}

	/**
	 * Find a child by name in a given parent directory.
	 */
	private async findChildByName(
		parentFileId: string,
		name: string,
	): Promise<string | null> {
		let marker = ''
		do {
			const result = await this.client.listFile({
				drive_id: this.client.driveId,
				parent_file_id: parentFileId,
				limit: 100,
				marker: marker || undefined,
			})

			for (const item of result.items) {
				if (item.name === name) {
					return item.file_id
				}
			}
			marker = result.next_marker
		} while (marker)

		return null
	}

	/**
	 * Build the full path for a file by walking up parent_file_ids.
	 */
	async buildPathFromFile(
		fileId: string,
		name: string,
		parentFileId: string,
	): Promise<string> {
		// Check cache
		const cached = this.idToPath.get(fileId)
		if (cached) {
			return cached
		}

		// Walk up to root
		const parts: string[] = [name]
		let currentParent = parentFileId

		while (currentParent && currentParent !== 'root') {
			const parentPath = this.idToPath.get(currentParent)
			if (parentPath) {
				const fullPath = this.normalizePath(parentPath + '/' + parts.reverse().join('/'))
				this.set(fullPath, fileId)
				return fullPath
			}

			// Query parent info
			try {
				const parentFile = await this.client.getFile({
					drive_id: this.client.driveId,
					file_id: currentParent,
				})
				parts.push(parentFile.name)
				currentParent = parentFile.parent_file_id
			} catch {
				break
			}
		}

		const fullPath = this.normalizePath('/' + parts.reverse().join('/'))
		this.set(fullPath, fileId)
		return fullPath
	}

	/**
	 * Clear all cached mappings.
	 */
	clear(): void {
		this.pathToId.clear()
		this.idToPath.clear()
		this.set('/', 'root')
	}

	/**
	 * Export cache for serialization.
	 */
	exportCache(): Record<string, string> {
		const result: Record<string, string> = {}
		for (const [path, id] of this.pathToId) {
			result[path] = id
		}
		return result
	}

	/**
	 * Import cache from serialized data.
	 */
	importCache(data: Record<string, string>): void {
		for (const [path, id] of Object.entries(data)) {
			this.set(path, id)
		}
	}
}
