import i18n from '~/i18n'
import logger from '~/utils/logger'
import { statVaultItem } from '~/utils/stat-vault-item'
import { BaseTask, toTaskError } from './task.interface'

export default class MkdirRemoteTask extends BaseTask {
	async exec() {
		try {
			const localStat = await statVaultItem(this.vault, this.localPath)
			if (!localStat) {
				logger.debug('MkdirRemoteTask: local path not found:', this.localPath)
				throw new Error(
					i18n.t('sync.error.localPathNotFound', { path: this.localPath }),
				)
			}

			if (!this.remoteStorage) {
				throw new Error('Remote storage not available')
			}

			await this.remoteStorage.createDirectory(this.remotePath, {
				recursive: true,
			})
			return { success: true } as const
		} catch (e) {
			logger.error(this, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}
}
