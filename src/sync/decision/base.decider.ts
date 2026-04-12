import { SyncRecord } from '~/storage/sync-record'
import type RemoteStorage from '~/remote-storage/remote-storage.interface'
import { MaybePromise } from '~/utils/types'
import { AlipanSync } from '..'
import { BaseTask } from '../tasks/task.interface'

export default abstract class BaseSyncDecider {
	constructor(
		protected sync: AlipanSync,
		protected syncRecordStorage: SyncRecord,
	) {}

	abstract decide(): MaybePromise<BaseTask[]>

	protected getSyncRecordStorage() {
		return this.syncRecordStorage
	}

	get remoteStorage(): RemoteStorage {
		return this.sync.remoteStorage
	}

	get settings() {
		return this.sync.settings
	}

	get vault() {
		return this.sync.vault
	}

	get remoteBaseDir() {
		return this.sync.remoteBaseDir
	}
}
