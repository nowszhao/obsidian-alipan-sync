/**
 * Generic remote storage file system implementation.
 *
 * Uses the RemoteStorage interface for BFS directory traversal,
 * making it compatible with any storage backend (e.g. Alipan).
 */

import { Vault } from 'obsidian'
import { isAbsolute } from 'path-browserify'
import { isNotNil } from 'ramda'
import type RemoteStorage from '~/remote-storage/remote-storage.interface'
import { useSettings } from '~/settings'
import GlobMatch, {
	GlobMatchOptions,
	isVoidGlobMatchOptions,
	needIncludeFromGlobRules,
} from '~/utils/glob-match'
import { isSub } from '~/utils/is-sub'
import logger from '~/utils/logger'
import { stdRemotePath } from '~/utils/std-remote-path'
import AbstractFileSystem from './fs.interface'
import completeLossDir from './utils/complete-loss-dir'

export class RemoteStorageFileSystem implements AbstractFileSystem {
	constructor(
		private options: {
			vault: Vault
			remoteStorage: RemoteStorage
			remoteBaseDir: string
		},
	) {}

	async walk() {
		const { remoteStorage, remoteBaseDir } = this.options
		const base = stdRemotePath(remoteBaseDir)

		// BFS traversal using RemoteStorage.getDirectoryContents
		let stats = await this.bfsTraverse(remoteStorage, base)

		if (stats.length === 0) {
			return []
		}

		// Filter to only include items under the remote base dir
		const subPath = new Set<string>()
		for (let item of stats) {
			let path = item.path
			if (path.endsWith('/')) {
				path = path.slice(0, path.length - 1)
			}
			if (!path.startsWith('/')) {
				path = `/${path}`
			}
			if (isSub(base, path)) {
				subPath.add(path)
			}
		}

		const statsMap = new Map(stats.map((s) => [s.path, s]))
		stats = [...subPath].map((path) => statsMap.get(path)).filter(isNotNil)

		// Convert absolute paths to relative
		for (const item of stats) {
			if (isAbsolute(item.path)) {
				item.path = item.path.replace(remoteBaseDir, '')
				if (item.path.startsWith('/')) {
					item.path = item.path.slice(1)
				}
			}
		}

		// Apply glob filter rules
		const settings = await useSettings()
		const exclusions = this.buildRules(settings?.filterRules.exclusionRules)
		const inclusions = this.buildRules(settings?.filterRules.inclusionRules)

		const includedStats = stats.filter((stat) =>
			needIncludeFromGlobRules(stat.path, inclusions, exclusions),
		)
		const completeStats = completeLossDir(stats, includedStats)
		const completeStatPaths = new Set(completeStats.map((s) => s.path))
		const results = stats.map((stat) => ({
			stat,
			ignored: !completeStatPaths.has(stat.path),
		}))
		return results
	}

	/**
	 * BFS traversal using RemoteStorage.getDirectoryContents.
	 */
	private async bfsTraverse(
		storage: RemoteStorage,
		rootPath: string,
	) {
		const queue: string[] = [rootPath]
		const allStats: import('~/model/stat.model').StatModel[] = []

		while (queue.length > 0) {
			const currentPath = queue.shift()!
			try {
				const contents = await storage.getDirectoryContents(currentPath)
				for (const item of contents) {
					allStats.push(item)
					if (item.isDir) {
						queue.push(item.path)
					}
				}
			} catch (err) {
				logger.error(`RemoteStorageFileSystem: Error traversing ${currentPath}`, err)
				throw err
			}
		}

		return allStats
	}

	private buildRules(rules: GlobMatchOptions[] = []): GlobMatch[] {
		return rules
			.filter((opt) => !isVoidGlobMatchOptions(opt))
			.map(({ expr, options }) => new GlobMatch(expr, options))
	}
}
