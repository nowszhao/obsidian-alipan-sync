import { AlipanSync, SyncStartMode } from '~/sync'
import logger from '~/utils/logger'
import { stdRemotePath } from '~/utils/std-remote-path'
import waitUntil from '~/utils/wait-until'
import type AlipanSyncPlugin from '..'

export interface SyncOptions {
	mode: SyncStartMode
}

export default class SyncExecutorService {
	constructor(private plugin: AlipanSyncPlugin) {}

	async executeSync(options: SyncOptions) {
		if (this.plugin.isSyncing) {
			return false
		}

		// 检查账号配置，未配置时静默返回（自动同步场景）
		if (!this.plugin.isAccountConfigured()) {
			return false
		}

		await waitUntil(() => this.plugin.isSyncing === false, 500)

		// 确保 configDir 始终在排除列表中，因为这个目录里的文件不支持同步
		const configDir = this.plugin.app.vault.configDir
		const hasConfigDirRule =
			this.plugin.settings.filterRules.exclusionRules.some(
				(rule) => rule.expr === configDir,
			)
		if (!hasConfigDirRule) {
			this.plugin.settings.filterRules.exclusionRules.push({
				expr: configDir,
				options: { caseSensitive: false },
			})
			await this.plugin.saveSettings()
		}

		// Build remote storage
		const remoteStorage = await this.plugin.createRemoteStorage?.()
		logger.info(
			`Sync: remoteStorage created, type=${remoteStorage?.type ?? 'undefined'}`,
		)

		if (!remoteStorage) {
			logger.info(
				'Alipan storage could not be created (token missing?). Skipping sync.',
			)
			return false
		}

		// Ensure remote base directory exists before deciding sync tasks.
		const remoteBaseDir = this.plugin.remoteBaseDir
		const normalizedDir = stdRemotePath(remoteBaseDir)
		const exists = await remoteStorage.exists(normalizedDir)
		if (!exists) {
			logger.info(
				`Remote base directory does not exist, creating: ${normalizedDir}`,
			)
			await remoteStorage.createDirectory(remoteBaseDir, {
				recursive: true,
			})
		}

		const sync = new AlipanSync(this.plugin, {
			vault: this.plugin.app.vault,
			remoteBaseDir,
			remoteStorage,
		})

		await sync.start({
			mode: options.mode,
		})

		// Persist Alipan path resolver cache
		if (remoteStorage && 'resolver' in remoteStorage) {
			try {
				const resolver = (remoteStorage as { resolver: { exportCache(): Record<string, string> } }).resolver
				this.plugin.settings.alipan = {
					...this.plugin.settings.alipan!,
					pathResolverCache: resolver.exportCache(),
				}
				await this.plugin.saveSettings()
			} catch (e) {
				logger.error('Failed to save Alipan path resolver cache:', e)
			}
		}

		return true
	}
}
