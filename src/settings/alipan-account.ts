/**
 * Alipan (阿里云盘) account settings panel.
 *
 * Handles OAuth2 authorization, account display, and logout for Alipan.
 * UX flow:
 *   - Not logged in: show Client ID input + one-click authorize button
 *   - Logged in: show user info + logout + check connection
 */
import { Notice, Setting } from 'obsidian'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import BaseSettings from './settings.base'

const ALIPAN_DEFAULT_AUTH_BASE = 'https://openapi.alipan.com'
const ALIPAN_DEFAULT_REDIRECT_URI = 'obsidian://alipan-sync/oauth'
const ALIPAN_SCOPES = 'user:base,file:all:read,file:all:write'

export default class AlipanAccountSettings extends BaseSettings {
	async display() {
		this.containerEl.empty()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.sections.account'))
			.setHeading()

		const alipanSettings = this.plugin.settings.alipan
		const isLoggedIn = !!alipanSettings?.accessToken

		if (isLoggedIn && alipanSettings) {
			await this.displayLoggedInState(alipanSettings)
		} else {
			await this.displayLoginState(alipanSettings)
		}
	}

	// ========================
	// Logged-in state
	// ========================

	private async displayLoggedInState(alipanSettings: NonNullable<typeof this.plugin.settings.alipan>) {
		const displayName =
			alipanSettings.userName || alipanSettings.userId || i18n.t('settings.ssoStatus.loggedIn')

		const el = new Setting(this.containerEl)
			.setName(i18n.t('settings.ssoStatus.loggedIn'))
			.setDesc(displayName)
			.addButton((button) => {
				button
					.setWarning()
					.setButtonText(i18n.t('settings.ssoStatus.logout'))
					.onClick(() => {
						// Reuse LogoutConfirmModal pattern
					const doLogout = async () => {
						this.plugin.settings.alipan = undefined
						await this.plugin.saveSettings()
						new Notice(i18n.t('settings.ssoStatus.logoutSuccess'))
						this.settings.display()
					}
						// Import and use LogoutConfirmModal dynamically
						import('~/components/LogoutConfirmModal').then(
							({ default: LogoutConfirmModal }) => {
								new LogoutConfirmModal(this.app, doLogout).open()
							},
						)
					})
			})
		el.descEl.classList.add('max-w-full', 'truncate')
		el.infoEl.classList.add('max-w-full')

		// Drive space selector: "全部文件 (resource)" vs "备份文件 (backup)"
		// Only show when we have both drive IDs available
		const hasResourceDrive = !!alipanSettings.resourceDriveId
		const hasBackupDrive = !!alipanSettings.backupDriveId

		if (hasResourceDrive || hasBackupDrive) {
			const currentType = alipanSettings.driveType || 'resource'
			new Setting(this.containerEl)
				.setName(i18n.t('settings.alipan.targetSpace'))
				.setDesc(
					createFragment((frag) => {
						frag.appendText(i18n.t('settings.alipan.targetSpaceDesc'))
						frag.createEl('br')
						frag.appendText(i18n.t('settings.alipan.targetSpaceHint'))
						if (alipanSettings.resourceDriveId) {
							frag.createEl('br')
							const small = frag.createEl('small')
							small.textContent = i18n.t('settings.alipan.resourceDriveId', { id: alipanSettings.resourceDriveId })
						}
						if (alipanSettings.backupDriveId) {
							frag.createEl('br')
							const small = frag.createEl('small')
							small.textContent = i18n.t('settings.alipan.backupDriveId', { id: alipanSettings.backupDriveId })
						}
					}),
				)
				.addDropdown((dropdown) => {
					if (hasResourceDrive) {
						dropdown.addOption('resource', i18n.t('settings.alipan.resourceDrive'))
					}
					if (hasBackupDrive) {
						dropdown.addOption('backup', i18n.t('settings.alipan.backupDrive'))
					}
					dropdown.setValue(currentType)
					dropdown.onChange(async (value) => {
						const newType = value as 'resource' | 'backup'
						const newDriveId =
							newType === 'resource'
								? alipanSettings.resourceDriveId
								: alipanSettings.backupDriveId

						if (!newDriveId) {
							new Notice(`所选空间的 Drive ID 不可用`)
							return
						}

						// When switching drives, clear path cache since file_ids are per-drive
						const driveChanged = alipanSettings.driveId !== newDriveId
						this.plugin.settings.alipan = {
							...alipanSettings,
							driveType: newType,
							driveId: newDriveId,
							pathResolverCache: driveChanged
								? undefined
								: alipanSettings.pathResolverCache,
						}
						await this.plugin.saveSettings()

					if (driveChanged) {
						new Notice(
							i18n.t('settings.alipan.driveSwitched', {
								space: newType === 'resource'
									? i18n.t('settings.alipan.resourceDrive')
									: i18n.t('settings.alipan.backupDrive'),
							}),
						)
						}
					})
				})
		} else {
			// Drive info not available yet — show informational text
			new Setting(this.containerEl)
				.setName('目标空间')
				.setDesc(
					'空间信息尚未获取。请先点击"检查连接"或重新授权登录以获取空间信息。',
				)
		}

		// Check connection button
		this.displayCheckConnection()
	}

	// ========================
	// Not-logged-in state
	// ========================

	private async displayLoginState(alipanSettings: typeof this.plugin.settings.alipan) {
		// Client ID input — saved to settings so user doesn't have to re-enter
		const savedClientId = alipanSettings?.clientId || ''
		let clientIdValue = savedClientId

		new Setting(this.containerEl)
			.setName(i18n.t('settings.alipan.appId'))
			.setDesc(
				createFragment((frag) => {
					frag.appendText(i18n.t('settings.alipan.appIdDesc'))
					const link = frag.createEl('a', {
						href: 'https://www.yuque.com/aliyundrive/zpfszx',
						text: i18n.t('settings.alipan.appIdHowTo'),
					})
					link.target = '_blank'
				}),
			)
			.addText((text) => {
				text
					.setPlaceholder(i18n.t('settings.alipan.appIdPlaceholder'))
					.setValue(clientIdValue)
					.onChange(async (value) => {
						clientIdValue = value.trim()
						// Persist immediately so the OAuth callback can find it
						this.ensureAlipanSettings({ clientId: clientIdValue })
						await this.plugin.saveSettings()
					})
			})

		// Redirect URI input — must match the one configured in Alipan Developer Console
		const savedRedirectUri = alipanSettings?.redirectUri || ALIPAN_DEFAULT_REDIRECT_URI
		let redirectUriValue = savedRedirectUri

		const redirectUriSetting = new Setting(this.containerEl)
			.setName('授权回调 URI (Redirect URI)')
			.setDesc(
				createFragment((frag) => {
					frag.appendText('必须与阿里云盘开放平台「授权回调URI」完全一致。')
					frag.createEl('br')
					frag.appendText('默认值: ')
					const code = frag.createEl('code')
					code.textContent = ALIPAN_DEFAULT_REDIRECT_URI
				}),
			)
			.addText((text) => {
				text
					.setPlaceholder(ALIPAN_DEFAULT_REDIRECT_URI)
					.setValue(redirectUriValue)
					.onChange(async (value) => {
						redirectUriValue = value.trim() || ALIPAN_DEFAULT_REDIRECT_URI
						this.ensureAlipanSettings({ clientId: clientIdValue, redirectUri: redirectUriValue })
						await this.plugin.saveSettings()
						// Update hint text
						updateRedirectHint()
					})
				text.inputEl.style.width = '100%'
				text.inputEl.style.minWidth = '300px'
			})

		// Show a warning if the URI scheme is not obsidian://
		const hintEl = redirectUriSetting.descEl.createEl('div', {
			cls: 'setting-item-description',
		})
		hintEl.style.marginTop = '4px'

		const updateRedirectHint = () => {
			hintEl.empty()
			if (redirectUriValue && !redirectUriValue.startsWith('obsidian://')) {
				hintEl.style.color = 'var(--text-warning)'
				hintEl.textContent =
					i18n.t('settings.alipan.redirectUriWarning')
			} else {
				hintEl.style.color = ''
				hintEl.textContent = ''
			}
		}
		updateRedirectHint()

		// ---- One-click authorize button ----
		new Setting(this.containerEl)
			.setName(i18n.t('settings.ssoStatus.notLoggedIn'))
			.addButton((button) => {
				button.setButtonText(i18n.t('settings.login.name'))
				button.setCta()

				// Wrap button in <a target="_blank"> for OAuth flow
				const anchor = document.createElement('a')
				anchor.target = '_blank'
				button.buttonEl.parentElement?.appendChild(anchor)
				anchor.appendChild(button.buttonEl)

				// Build the OAuth URL
				const updateHref = () => {
					if (!clientIdValue) {
						anchor.removeAttribute('href')
						return
					}
					const baseUrl = alipanSettings?.authBaseUrl || ALIPAN_DEFAULT_AUTH_BASE
					anchor.href =
						`${baseUrl}/oauth/authorize?` +
						`client_id=${encodeURIComponent(clientIdValue)}&` +
						`redirect_uri=${encodeURIComponent(redirectUriValue)}&` +
						`response_type=code&` +
						`scope=${encodeURIComponent(ALIPAN_SCOPES)}`
				}
				updateHref()

				// Also intercept click to validate & save first
				anchor.addEventListener('click', (e) => {
					if (!clientIdValue) {
						e.preventDefault()
						new Notice('请先输入 App ID')
						return
					}
					// Ensure settings are saved before navigating
					this.ensureAlipanSettings({
						clientId: clientIdValue,
						redirectUri: redirectUriValue,
					})
					this.plugin.saveSettings()
					updateHref()
				})

				// Refresh URL periodically in case user changes fields
				const timer = window.setInterval(() => {
					if (document.contains(anchor)) {
						updateHref()
					} else {
						window.clearInterval(timer)
					}
				}, 2000)
			})

		// ---- Advanced: manual token config (collapsed) ----
		const advancedDetails = this.containerEl.createEl('details')
		advancedDetails.createEl('summary', {
			text: '高级配置',
			cls: 'setting-item-name',
		})
		advancedDetails.style.marginTop = '1em'
		advancedDetails.style.cursor = 'pointer'

		const advancedContainer = advancedDetails.createDiv()
		advancedContainer.style.paddingTop = '0.5em'

		// Client Secret (optional, most desktop apps don't need it)
		let clientSecretValue = alipanSettings?.clientSecret || ''

		new Setting(advancedContainer)
			.setName(i18n.t('settings.alipan.appSecret'))
			.setDesc(i18n.t('settings.alipan.appSecretDesc'))
			.addText((text) => {
				text
					.setPlaceholder(i18n.t('settings.alipan.appSecretPlaceholder'))
					.setValue(clientSecretValue)
					.onChange(async (value) => {
						clientSecretValue = value.trim()
						this.ensureAlipanSettings({
							clientId: clientIdValue,
							clientSecret: clientSecretValue,
							redirectUri: redirectUriValue,
						})
						await this.plugin.saveSettings()
					})
				text.inputEl.type = 'password'
			})

		let refreshTokenValue = ''
		let driveIdValue = ''

		new Setting(advancedContainer)
			.setName('Refresh Token')
			.setDesc('手动输入 Refresh Token')
			.addText((text) => {
				text.setPlaceholder('输入 Refresh Token').onChange((value) => {
					refreshTokenValue = value
				})
				text.inputEl.type = 'password'
			})

		new Setting(advancedContainer)
			.setName('Drive ID')
			.setDesc('云盘空间 ID')
			.addText((text) => {
				text.setPlaceholder('输入 Drive ID').onChange((value) => {
					driveIdValue = value
				})
			})

		new Setting(advancedContainer).addButton((button) => {
			button.setButtonText(i18n.t('settings.alipan.saveAndConnect')).onClick(async () => {
				if (!clientIdValue || !refreshTokenValue || !driveIdValue) {
					new Notice(
						i18n.t('settings.alipan.fieldsRequired'),
					)
					return
				}

				this.plugin.settings.alipan = {
					clientId: clientIdValue,
					clientSecret: clientSecretValue || undefined,
					redirectUri: redirectUriValue,
					driveId: driveIdValue,
					accessToken: '', // Will be obtained via refresh
					refreshToken: refreshTokenValue,
					expiresAt: 0, // Force immediate refresh
				}
				await this.plugin.saveSettings()
				new Notice(i18n.t('settings.alipan.configSaved'))
				this.settings.display()
			})
		})
	}

	// ========================
	// Check Connection
	// ========================

	private displayCheckConnection() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.checkConnection.name'))
			.setDesc(i18n.t('settings.checkConnection.desc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.checkConnection.name'))
					.onClick(async (e) => {
						const buttonEl = e.target as HTMLElement
						buttonEl.classList.add('connection-button', 'loading')
						buttonEl.classList.remove('success', 'error')
						buttonEl.textContent = i18n.t('settings.checkConnection.name')
						try {
							const storage =
								await this.plugin.createRemoteStorage?.()
							if (storage) {
								await storage.exists('/')

								// On success, also fetch drive info if we don't have it yet
								// so the drive space selector becomes available.
								await this.fetchAndSaveDriveInfo()

								buttonEl.classList.remove('loading')
								buttonEl.classList.add('success')
								buttonEl.textContent = i18n.t(
									'settings.checkConnection.successButton',
								)
								new Notice(
									i18n.t('settings.checkConnection.success'),
								)
								// Refresh the settings page to show the drive selector
								this.settings.display()
							} else {
								buttonEl.classList.remove('loading')
								buttonEl.classList.add('error')
								buttonEl.textContent = i18n.t(
									'settings.checkConnection.failureButton',
								)
								new Notice(
									i18n.t('settings.checkConnection.failure'),
								)
							}
						} catch (err) {
							buttonEl.classList.remove('loading')
							buttonEl.classList.add('error')
							buttonEl.textContent = i18n.t(
								'settings.checkConnection.failureButton',
							)
							logger.error('Alipan connection check failed:', err)
							new Notice(
								i18n.t('settings.checkConnection.failure'),
							)
						}
					})
			})
	}

	// ========================
	// Helpers
	// ========================

	/**
	 * Fetch drive info from Alipan API and save resource/backup drive IDs.
	 * This is called on check-connection and on OAuth callback to ensure
	 * we always have both drive IDs for the drive space selector.
	 */
	private async fetchAndSaveDriveInfo() {
		const alipanSettings = this.plugin.settings.alipan
		if (!alipanSettings?.accessToken) return

		// Skip if we already have both drive IDs
		if (alipanSettings.resourceDriveId && alipanSettings.backupDriveId) return

		try {
			const requestUrlModule = await import('~/utils/request-url')
			const requestUrl = requestUrlModule.default

			const apiBase = alipanSettings.apiBaseUrl || 'https://openapi.alipan.com'
			const driveInfoResp = await requestUrl({
				url: `${apiBase}/adrive/v1.0/user/getDriveInfo`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${alipanSettings.accessToken}`,
				},
				body: '{}',
			})
			const driveInfo = JSON.parse(driveInfoResp.text)
			const resourceDriveId = String(driveInfo.resource_drive_id || '')
			const backupDriveId = String(driveInfo.backup_drive_id || driveInfo.default_drive_id || '')

			// Update settings
			this.plugin.settings.alipan = {
				...alipanSettings,
				resourceDriveId: resourceDriveId || alipanSettings.resourceDriveId,
				backupDriveId: backupDriveId || alipanSettings.backupDriveId,
			}

			// If current driveId matches backup but user wants resource, update it
			const driveType = alipanSettings.driveType || 'resource'
			if (driveType === 'resource' && resourceDriveId && alipanSettings.driveId !== resourceDriveId) {
				this.plugin.settings.alipan.driveId = resourceDriveId
				// Clear path cache since file_ids are per-drive
				this.plugin.settings.alipan.pathResolverCache = undefined
				logger.info(`Alipan: Switched driveId from ${alipanSettings.driveId} to resource drive ${resourceDriveId}`)
			}

			await this.plugin.saveSettings()
		} catch (err) {
			logger.error('Failed to fetch Alipan drive info:', err)
		}
	}

	/**
	 * Ensure the alipan settings object exists with at least the Client ID,
	 * so the OAuth callback handler can find it.
	 */
	private ensureAlipanSettings(opts: {
		clientId: string
		clientSecret?: string
		redirectUri?: string
	}) {
		if (!this.plugin.settings.alipan) {
			this.plugin.settings.alipan = {
				clientId: opts.clientId,
				clientSecret: opts.clientSecret || undefined,
				redirectUri: opts.redirectUri || ALIPAN_DEFAULT_REDIRECT_URI,
				driveId: '',
				accessToken: '',
				refreshToken: '',
				expiresAt: 0,
			}
		} else {
			this.plugin.settings.alipan.clientId = opts.clientId
			if (opts.clientSecret !== undefined) {
				this.plugin.settings.alipan.clientSecret = opts.clientSecret || undefined
			}
			if (opts.redirectUri !== undefined) {
				this.plugin.settings.alipan.redirectUri = opts.redirectUri
			}
		}
	}
}
