/**
 * Alipan (阿里云盘) API client types and configuration.
 *
 * Based on the Alipan Open Platform PDS API (2022-03-01).
 * API Docs: https://help.aliyun.com/zh/pds/drive-and-photo-service-dev/developer-reference/api-pds-2022-03-01-overview
 */

// ========================
// Configuration
// ========================

export interface AlipanConfig {
	/** OAuth client ID from Alipan Developer Portal */
	clientId: string
	/** OAuth client secret (for web server apps) */
	clientSecret?: string
	/** API base URL, typically https://openapi.alipan.com or custom PDS domain */
	apiBaseUrl: string
	/** OAuth authorize URL */
	authBaseUrl: string
	/** Drive ID (space id) */
	driveId: string
}

export const ALIPAN_DEFAULT_CONFIG: Partial<AlipanConfig> = {
	apiBaseUrl: 'https://openapi.alipan.com',
	authBaseUrl: 'https://openapi.alipan.com',
}

// ========================
// OAuth Types
// ========================

export interface AlipanTokenResponse {
	access_token: string
	refresh_token: string
	expires_in: number
	token_type: string
	/** User's default drive id */
	default_drive_id?: string
	/** User id */
	user_id?: string
	/** User name */
	user_name?: string
	/** Avatar URL */
	avatar?: string
}

export interface AlipanTokenRequest {
	grant_type: 'authorization_code' | 'refresh_token'
	code?: string
	redirect_uri?: string
	client_id: string
	client_secret?: string
	refresh_token?: string
}

// ========================
// File Types
// ========================

export interface AlipanFile {
	domain_id: string
	drive_id: string
	file_id: string
	name: string
	type: 'file' | 'folder'
	parent_file_id: string
	size?: number
	content_type?: string
	content_hash?: string
	content_hash_name?: string
	crc64_hash?: string
	created_at: string
	updated_at: string
	status?: string
	category?: string
	download_url?: string
	thumbnail?: string
	file_extension?: string
	trashed?: boolean
	hidden?: boolean
	description?: string
}

export interface AlipanCreateFileRequest {
	name: string
	type: 'file' | 'folder'
	parent_file_id: string
	drive_id: string
	size?: number
	content_type?: string
	content_hash?: string
	content_hash_name?: string
	check_name_mode?: 'ignore' | 'auto_rename' | 'refuse'
	part_info_list?: Array<{ part_number: number }>
	local_created_at?: string
	local_modified_at?: string
}

export interface AlipanCreateFileResponse {
	domain_id: string
	drive_id: string
	file_id: string
	file_name: string
	parent_file_id: string
	status: string
	type: string
	upload_id?: string
	rapid_upload?: boolean
	exist?: boolean
	part_info_list?: Array<{
		part_number: number
		upload_url: string
		internal_upload_url?: string
	}>
}

export interface AlipanCompleteFileRequest {
	drive_id: string
	file_id: string
	upload_id: string
}

export interface AlipanGetDownloadUrlRequest {
	drive_id: string
	file_id: string
	expire_sec?: number
}

export interface AlipanGetDownloadUrlResponse {
	url: string
	internal_url?: string
	cdn_url?: string
	expiration: string
	size: number
	crc64_hash?: string
	content_hash?: string
	content_hash_name?: string
}

export interface AlipanListFileRequest {
	drive_id: string
	parent_file_id: string
	limit?: number
	marker?: string
	order_by?: 'created_at' | 'updated_at' | 'size' | 'name'
	order_direction?: 'ASC' | 'DESC'
	type?: 'file' | 'folder'
	fields?: string
}

export interface AlipanListFileResponse {
	items: AlipanFile[]
	next_marker: string
}

export interface AlipanGetFileRequest {
	drive_id: string
	file_id: string
	fields?: string
}

export interface AlipanDeleteFileRequest {
	drive_id: string
	file_id: string
}

export interface AlipanMoveFileRequest {
	drive_id: string
	file_id: string
	to_parent_file_id: string
	check_name_mode?: 'ignore' | 'auto_rename' | 'refuse'
	new_name?: string
}

// ========================
// Delta / Incremental Sync Types
// ========================

export interface AlipanDeltaItem {
	file_id: string
	op: 'create' | 'overwrite' | 'delete' | 'update' | 'move' | 'trash' | 'restore' | 'rename'
	file: AlipanFile
}

export interface AlipanListDeltaRequest {
	drive_id: string
	sync_root_id?: string
	cursor?: string
	limit?: number
}

export interface AlipanListDeltaResponse {
	items: AlipanDeltaItem[]
	has_more: boolean
	cursor: string
}

export interface AlipanGetLastCursorRequest {
	drive_id: string
	sync_root_id?: string
}

export interface AlipanGetLastCursorResponse {
	cursor: string
}
