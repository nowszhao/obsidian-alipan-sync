import { StatModel } from '~/model/stat.model'
import { MaybePromise } from '~/utils/types'

/**
 * Buffer-like type that represents binary content.
 * Compatible with ArrayBuffer and Buffer.
 */
export type RemoteBufferLike = ArrayBuffer | Buffer

/**
 * Result of a delta sync operation.
 */
export interface DeltaEntry {
	path: string
	size: number
	isDeleted: boolean
	isDir: boolean
	modified: string
	revision?: number
}

export interface DeltaResponse {
	reset: boolean
	cursor: string
	hasMore: boolean
	entries: DeltaEntry[]
}

/**
 * Options for file upload.
 */
export interface UploadOptions {
	overwrite?: boolean
}

/**
 * Options for file download.
 */
export interface DownloadOptions {
	format?: 'binary' | 'text'
}

/**
 * Options for creating a directory.
 */
export interface MkdirOptions {
	recursive?: boolean
}

/**
 * Options for stat (file metadata).
 */
export interface StatOptions {
	details?: boolean
}

/**
 * Abstract interface for remote storage backends.
 *
 * This interface defines the contract that all remote storage implementations
 * (e.g., Alipan, etc.) must fulfill.
 *
 * It covers:
 * - File CRUD operations (upload, download, delete, stat)
 * - Directory operations (create, list)
 * - Delta/incremental sync (getDelta, getLatestDeltaCursor)
 * - Path existence checking
 */
export default abstract class RemoteStorage {
	/**
	 * Unique identifier for this storage backend type.
	 * e.g., 'alipan'
	 */
	abstract readonly type: string

	// ========================
	// File Operations
	// ========================

	/**
	 * Upload file content to the remote path.
	 * @param remotePath - The remote file path
	 * @param content - The file content as binary or string
	 * @param options - Upload options
	 * @returns true if the upload was successful
	 */
	abstract putFileContents(
		remotePath: string,
		content: RemoteBufferLike | string,
		options?: UploadOptions,
	): MaybePromise<boolean>

	/**
	 * Download file content from the remote path.
	 * @param remotePath - The remote file path
	 * @param options - Download options
	 * @returns The file content as binary
	 */
	abstract getFileContents(
		remotePath: string,
		options?: DownloadOptions,
	): MaybePromise<RemoteBufferLike>

	/**
	 * Delete a file or directory at the remote path.
	 * @param remotePath - The remote file/directory path
	 */
	abstract deleteFile(remotePath: string): MaybePromise<void>

	/**
	 * Get file/directory metadata.
	 * @param remotePath - The remote path
	 * @returns StatModel with file metadata
	 */
	abstract stat(remotePath: string): MaybePromise<StatModel>

	// ========================
	// Directory Operations
	// ========================

	/**
	 * Create a directory at the remote path.
	 * @param remotePath - The remote directory path
	 * @param options - Options (e.g., recursive creation)
	 */
	abstract createDirectory(
		remotePath: string,
		options?: MkdirOptions,
	): MaybePromise<void>

	/**
	 * Check if a remote path exists.
	 * @param remotePath - The remote path to check
	 * @returns true if the path exists
	 */
	abstract exists(remotePath: string): MaybePromise<boolean>

	// ========================
	// Delta / Incremental Sync
	// ========================

	/**
	 * Get the latest delta cursor for incremental sync.
	 * @param folderName - The root folder name
	 * @returns The cursor string
	 */
	abstract getLatestDeltaCursor(folderName: string): MaybePromise<string>

	/**
	 * Get delta changes since the given cursor.
	 * @param folderName - The root folder name
	 * @param cursor - The cursor from the last sync (empty string for first sync)
	 * @returns Delta response with entries and new cursor
	 */
	abstract getDelta(
		folderName: string,
		cursor: string,
	): MaybePromise<DeltaResponse>

	// ========================
	// Directory Listing (for BFS traversal)
	// ========================

	/**
	 * List directory contents (non-recursive, one level).
	 * @param remotePath - The remote directory path
	 * @returns Array of StatModel for each item in the directory
	 */
	abstract getDirectoryContents(remotePath: string): MaybePromise<StatModel[]>
}
