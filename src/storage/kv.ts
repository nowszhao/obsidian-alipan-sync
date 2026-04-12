import localforage from 'localforage'
import { StatModel } from '~/model/stat.model'
import { SyncRecordModel } from '~/model/sync-record.model'
import useStorage from './use-storage'

const DB_NAME = 'Alipan_Sync_Plugin_Cache'

export const syncRecordKV = useStorage<Map<string, SyncRecordModel>>(
	localforage.createInstance({
		name: DB_NAME,
		storeName: 'sync_record',
	}),
)

export const blobKV = useStorage<Blob>(
	localforage.createInstance({
		name: DB_NAME,
		storeName: 'base_blob_store',
	}),
)

export interface RemoteTraversalCache {
	rootCursor: string
	queue: string[]
	nodes: Record<string, StatModel[]>
}

/** @deprecated Use RemoteTraversalCache */
export type TraverseRemoteCache = RemoteTraversalCache

export const traverseCacheKV = useStorage<RemoteTraversalCache>(
	localforage.createInstance({
		name: DB_NAME,
		// Keep old storeName for backward compatibility with existing user data
		storeName: 'traverse_webdav_cache',
	}),
)

/** @deprecated Use traverseCacheKV */
export const traverseRemoteKV = traverseCacheKV
