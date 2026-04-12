import 'blob-polyfill'
import 'core-js/stable'

import './polyfill'

import './assets/styles/global.css'

import { normalizePath, Notice, Plugin } from 'obsidian'
import { SyncRibbonManager } from './components/SyncRibbonManager'
import { emitCancelSync } from './events'
import { emitSsoReceive } from './events/sso-receive'
import i18n from './i18n'
import ScheduledSyncService from './services/scheduled-sync.service'
import CommandService from './services/command.service'
import EventsService from './services/events.service'
import I18nService from './services/i18n.service'
import LoggerService from './services/logger.service'
import { ProgressService } from './services/progress.service'
import RealtimeSyncService from './services/realtime-sync.service'
import { StatusService } from './services/status.service'
import SyncExecutorService from './services/sync-executor.service'
import type RemoteStorage from './remote-storage/remote-storage.interface'
import {
	AlipanSettings,
	AlipanSyncSettings,
	AlipanSettingTab,
	setPluginInstance,
	SyncMode,
} from './settings'
import { ConflictStrategy } from './sync/tasks/conflict-resolve.task'
import { GlobMatchOptions } from './utils/glob-match'
import logger from './utils/logger'
import { stdRemotePath } from './utils/std-remote-path'

export default class AlipanSyncPlugin extends Plugin {
	public isSyncing: boolean = false
	public settings: AlipanSyncSettings

	public commandService = new CommandService(this)
	public eventsService = new EventsService(this)
	public i18nService = new I18nService(this)
	public loggerService = new LoggerService(this)
	public progressService = new ProgressService(this)
	public ribbonManager = new SyncRibbonManager(this)
	public statusService = new StatusService(this)
	public syncExecutorService = new SyncExecutorService(this)
	public realtimeSyncService = new RealtimeSyncService(
		this,
		this.syncExecutorService,
	)
	public scheduledSyncService = new ScheduledSyncService(this, this.syncExecutorService)

	/**
	 * Create a RemoteStorage instance based on current settings.
	 * Always creates an AlipanRemoteStorage.
	 */
	public createRemoteStorage?: () => Promise<RemoteStorage | undefined>

	async onload() {
		await this.loadSettings()
		this.addSettingTab(new AlipanSettingTab(this.app, this))

		// Register Alipan OAuth callback handler
		this.registerObsidianProtocolHandler(
			'alipan-sync/oauth',
			async (data) => {
				if (data?.code) {
					await this.handleAlipanOAuthCallback(data.code)
				}
			},
		)

		setPluginInstance(this)

		// Setup remote storage factory
		this.setupRemoteStorage()

		await this.scheduledSyncService.start()
	}

	/**
	 * Setup the Alipan remote storage factory.
	 */
	private setupRemoteStorage() {
		this.createRemoteStorage = async () => {
			const alipanSettings = this.settings.alipan
			if (!alipanSettings?.accessToken) {
				logger.warn('createRemoteStorage: No accessToken, returning undefined')
				return undefined
			}

			logger.info(`createRemoteStorage: Creating AlipanRemoteStorage, driveId=${alipanSettings.driveId}`)

			const { AlipanRemoteStorage, AlipanClient } = await import(
				'./remote-storage/alipan'
			)
			const client = new AlipanClient(
				{
					clientId: alipanSettings.clientId,
					clientSecret: alipanSettings.clientSecret,
					apiBaseUrl: alipanSettings.apiBaseUrl || 'https://openapi.alipan.com',
					authBaseUrl: alipanSettings.authBaseUrl || 'https://openapi.alipan.com',
					driveId: alipanSettings.driveId,
				},
				{
					accessToken: alipanSettings.accessToken,
					refreshToken: alipanSettings.refreshToken,
					expiresAt: alipanSettings.expiresAt || 0,
				},
				// Save refreshed tokens back to settings
				async (newAuth) => {
					this.settings.alipan = {
						...alipanSettings,
						accessToken: newAuth.accessToken,
						refreshToken: newAuth.refreshToken,
						expiresAt: newAuth.expiresAt,
					}
					await this.saveSettings()
				},
			)

			const storage = new AlipanRemoteStorage(client)

			// Restore path resolver cache if available
			if (alipanSettings.pathResolverCache) {
				storage.resolver.importCache(alipanSettings.pathResolverCache)
			}

			return storage
		}
	}

	async onunload() {
		setPluginInstance(null)
		emitCancelSync()
		this.scheduledSyncService.unload()
		this.progressService.unload()
		this.eventsService.unload()
		this.realtimeSyncService.unload()
		this.statusService.unload()
	}

	async loadSettings() {
		function createGlobMathOptions(expr: string) {
			return {
				expr,
				options: {
					caseSensitive: false,
				},
			} satisfies GlobMatchOptions
		}
		const DEFAULT_SETTINGS: AlipanSyncSettings = {
			remoteDir: '',
			remoteCacheDir: '',
			useGitStyle: false,
			conflictStrategy: ConflictStrategy.DiffMatchPatch,
			confirmBeforeSync: true,
			confirmBeforeDeleteInAutoSync: true,
			syncMode: SyncMode.LOOSE,
			filterRules: {
				exclusionRules: [
					'**/.git',
					'**/.DS_Store',
					'**/.trash',
					this.app.vault.configDir,
				].map(createGlobMathOptions),
				inclusionRules: [],
			},
			skipLargeFiles: {
				maxSize: '30 MB',
			},
			realtimeSync: false,
			startupSyncDelaySeconds: 0,
			autoSyncIntervalSeconds: 300,
			language: undefined,
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	toggleSyncUI(isSyncing: boolean) {
		this.isSyncing = isSyncing
		this.ribbonManager.update()
	}

	/**
	 * 检查账号配置是否完整
	 */
	isAccountConfigured(): boolean {
		const alipan = this.settings.alipan
		return !!(
			alipan?.clientId &&
			alipan?.refreshToken &&
			alipan?.driveId
		)
	}

	get remoteBaseDir() {
		let remoteDir = normalizePath(this.settings.remoteDir.trim())
		if (remoteDir === '' || remoteDir === '/') {
			remoteDir = this.app.vault.getName()
		}
		return stdRemotePath(remoteDir)
	}

	/**
	 * Handle Alipan OAuth callback with authorization code.
	 * Exchanges the code for access/refresh tokens and saves to settings.
	 */
	private async handleAlipanOAuthCallback(code: string) {
		try {
			const alipanSettings = this.settings.alipan
			if (!alipanSettings?.clientId) {
				new Notice(i18n.t('settings.checkConnection.failure') + ': 请先配置阿里云盘 App ID')
				return
			}

			const requestUrlModule = await import('./utils/request-url')
			const requestUrl = requestUrlModule.default

			// Exchange authorization code for tokens
			const tokenUrl = alipanSettings.apiBaseUrl
				? `${alipanSettings.apiBaseUrl}/oauth/access_token`
				: 'https://openapi.alipan.com/oauth/access_token'

			const tokenBody: Record<string, string> = {
				client_id: alipanSettings.clientId,
				grant_type: 'authorization_code',
				code,
			}
			if (alipanSettings.clientSecret) {
				tokenBody.client_secret = alipanSettings.clientSecret
			}

			const response = await requestUrl({
				url: tokenUrl,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(tokenBody),
			})

			const data = JSON.parse(response.text)
			if (!data.access_token) {
				new Notice('阿里云盘授权失败: ' + (data.message || '未知错误'))
				return
			}

			// Fetch drive info
			let resourceDriveId = alipanSettings.resourceDriveId || ''
			let backupDriveId = alipanSettings.backupDriveId || ''
			const fallbackDriveId = String(data.default_drive_id || '')

			try {
				const apiBase = alipanSettings.apiBaseUrl || 'https://openapi.alipan.com'
				const driveInfoResp = await requestUrl({
					url: `${apiBase}/adrive/v1.0/user/getDriveInfo`,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${data.access_token}`,
					},
					body: '{}',
				})
				const driveInfo = JSON.parse(driveInfoResp.text)
				resourceDriveId = String(driveInfo.resource_drive_id || '')
				backupDriveId = String(driveInfo.backup_drive_id || driveInfo.default_drive_id || '')
			} catch (driveErr) {
				console.error('Failed to get drive info:', driveErr)
				if (!backupDriveId && fallbackDriveId) {
					backupDriveId = fallbackDriveId
				}
			}

			// Determine which drive to use
			const driveType = alipanSettings.driveType || 'resource'
			let driveId: string
			if (driveType === 'resource' && resourceDriveId) {
				driveId = resourceDriveId
			} else if (driveType === 'backup' && backupDriveId) {
				driveId = backupDriveId
			} else {
				driveId = resourceDriveId || backupDriveId || fallbackDriveId || alipanSettings.driveId || ''
			}

			// Save tokens to settings
			this.settings.alipan = {
				...alipanSettings,
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
				driveId,
				resourceDriveId,
				backupDriveId,
				driveType,
				userId: data.user_id,
				userName: data.user_name,
				pathResolverCache: alipanSettings.driveId === driveId
					? alipanSettings.pathResolverCache
					: undefined,
			}
			await this.saveSettings()

			new Notice(i18n.t('settings.login.success'), 5000)
			emitSsoReceive({ token: data.access_token })
		} catch (e) {
			new Notice('阿里云盘授权失败: ' + (e as Error).message)
		}
	}
}
