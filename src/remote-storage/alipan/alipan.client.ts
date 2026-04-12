/**
 * Alipan (阿里云盘) API HTTP client.
 *
 * Handles all HTTP communication with the Alipan Open Platform API.
 * Manages authentication tokens (access_token / refresh_token) automatically.
 */

import requestUrl from '~/utils/request-url'
import sleep from '~/utils/sleep'
import logger from '~/utils/logger'
import {
	AlipanConfig,
	AlipanTokenResponse,
	AlipanCreateFileRequest,
	AlipanCreateFileResponse,
	AlipanCompleteFileRequest,
	AlipanGetDownloadUrlRequest,
	AlipanGetDownloadUrlResponse,
	AlipanListFileRequest,
	AlipanListFileResponse,
	AlipanGetFileRequest,
	AlipanDeleteFileRequest,
	AlipanMoveFileRequest,
	AlipanListDeltaRequest,
	AlipanListDeltaResponse,
	AlipanGetLastCursorRequest,
	AlipanGetLastCursorResponse,
	AlipanFile,
} from './alipan.types'

export interface AlipanAuthState {
	accessToken: string
	refreshToken: string
	expiresAt: number
}

export type OnTokenRefreshed = (authState: AlipanAuthState) => void

/**
 * Default minimum interval (ms) between consecutive API requests.
 * Alipan Open Platform has strict rate limits; spacing requests avoids 429 errors.
 */
const DEFAULT_MIN_REQUEST_INTERVAL = 200

/**
 * Maximum number of retries for 429 (TooManyRequests) responses.
 */
const MAX_429_RETRIES = 5

export class AlipanClient {
	private authState: AlipanAuthState
	private config: AlipanConfig
	private onTokenRefreshed?: OnTokenRefreshed

	/** Timestamp of the last API request, used for rate limiting */
	private lastRequestTime = 0

	constructor(
		config: AlipanConfig,
		authState: AlipanAuthState,
		onTokenRefreshed?: OnTokenRefreshed,
	) {
		this.config = config
		this.authState = authState
		this.onTokenRefreshed = onTokenRefreshed
	}

	get driveId(): string {
		return this.config.driveId
	}

	// ========================
	// Token Management
	// ========================

	private isTokenExpired(): boolean {
		// Refresh 5 minutes before expiration
		return Date.now() >= this.authState.expiresAt - 5 * 60 * 1000
	}

	private async ensureValidToken(): Promise<void> {
		if (this.isTokenExpired()) {
			await this.refreshAccessToken()
		}
	}

	async refreshAccessToken(): Promise<void> {
		logger.info('Alipan: Refreshing access token...')
		const response = await requestUrl({
			url: `${this.config.apiBaseUrl}/oauth/access_token`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				grant_type: 'refresh_token',
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				refresh_token: this.authState.refreshToken,
			}),
			throw: false,
		})

		if (response.status >= 400) {
			throw new Error(
				`Alipan refresh token failed [${response.status}]: ${response.text}`,
			)
		}

		const data: AlipanTokenResponse = JSON.parse(response.text)
		this.authState = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		}

		this.onTokenRefreshed?.(this.authState)
		logger.info('Alipan: Access token refreshed successfully')
	}

	// ========================
	// HTTP Request Helper
	// ========================

	private async request<T>(
		path: string,
		body?: unknown,
		options?: { retryOn401?: boolean },
	): Promise<T> {
		await this.ensureValidToken()

		// Rate limiting: ensure minimum interval between requests
		const now = Date.now()
		const elapsed = now - this.lastRequestTime
		if (elapsed < DEFAULT_MIN_REQUEST_INTERVAL) {
			await sleep(DEFAULT_MIN_REQUEST_INTERVAL - elapsed)
		}

		const requestBody = body ? JSON.stringify(body) : undefined
		const url = `${this.config.apiBaseUrl}${path}`

		for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
			this.lastRequestTime = Date.now()

			// Use throw: false so we can handle status codes ourselves
			const response = await requestUrl({
				url,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.authState.accessToken}`,
				},
				body: requestBody,
				throw: false,
			})

			if (response.status === 401 && options?.retryOn401 !== false) {
				// Token expired, refresh and retry once
				await this.refreshAccessToken()
				return this.request<T>(path, body, { retryOn401: false })
			}

			if (response.status === 429) {
				// Rate limited — parse wait time from response and retry
				const waitMs = this.parse429WaitTime(response.text)
				logger.info(
					`Alipan API 429 rate limited on ${path}, waiting ${waitMs}ms before retry (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
				)
				await sleep(waitMs)
				continue
			}

			if (response.status >= 400) {
				const errorText = response.text || '(empty response body)'
				logger.error(`Alipan API error [${response.status}] ${path}: ${errorText}`)
				throw new Error(
					`Alipan API error [${response.status}] ${path}: ${errorText}` +
					(response.status === 501
						? ` (该接口返回501，可能原因：1) 应用未在开放平台获得API权限 2) drive_id不正确。当前drive_id=${this.config.driveId})`
						: ''),
				)
			}

			return JSON.parse(response.text)
		}

		// Exhausted all retries
		throw new Error(
			`Alipan API error [429] ${path}: 请求被限流，已重试 ${MAX_429_RETRIES} 次仍然失败。请稍后再试。`,
		)
	}

	/**
	 * Parse the wait time from a 429 response body.
	 * Alipan returns messages like "请求过快，请等待 1329 毫秒后再请求".
	 * Falls back to 2000ms if parsing fails.
	 */
	private parse429WaitTime(responseText: string): number {
		try {
			const parsed = JSON.parse(responseText)
			const message = parsed.message || ''
			// Extract number from "请等待 1329 毫秒后再请求"
			const match = message.match(/(\d+)\s*毫秒/)
			if (match) {
				// Add a small buffer to avoid hitting the limit again immediately
				return parseInt(match[1], 10) + 200
			}
		} catch {
			// ignore parse errors
		}
		// Default wait time if we can't parse the response
		return 2000
	}

	// ========================
	// File Operations
	// ========================

	async createFile(req: AlipanCreateFileRequest): Promise<AlipanCreateFileResponse> {
		return this.request<AlipanCreateFileResponse>('/adrive/v1.0/openFile/create', req)
	}

	async completeFile(req: AlipanCompleteFileRequest): Promise<AlipanFile> {
		return this.request<AlipanFile>('/adrive/v1.0/openFile/complete', req)
	}

	async getDownloadUrl(req: AlipanGetDownloadUrlRequest): Promise<AlipanGetDownloadUrlResponse> {
		return this.request<AlipanGetDownloadUrlResponse>('/adrive/v1.0/openFile/getDownloadUrl', req)
	}

	async listFile(req: AlipanListFileRequest): Promise<AlipanListFileResponse> {
		return this.request<AlipanListFileResponse>('/adrive/v1.0/openFile/list', req)
	}

	async getFile(req: AlipanGetFileRequest): Promise<AlipanFile> {
		return this.request<AlipanFile>('/adrive/v1.0/openFile/get', req)
	}

	async deleteFile(req: AlipanDeleteFileRequest): Promise<void> {
		await this.request<void>('/adrive/v1.0/openFile/delete', req)
	}

	async moveFile(req: AlipanMoveFileRequest): Promise<AlipanFile> {
		return this.request<AlipanFile>('/adrive/v1.0/openFile/move', req)
	}

	async trashFile(req: AlipanDeleteFileRequest): Promise<void> {
		await this.request<void>('/adrive/v1.0/openFile/recyclebin/trash', req)
	}

	// ========================
	// Upload (direct PUT to upload_url)
	// ========================

	async uploadPartContent(
		uploadUrl: string,
		content: ArrayBuffer,
	): Promise<void> {
		// IMPORTANT: Do NOT set Content-Type header here.
		// The upload_url is a pre-signed OSS URL. If we send a Content-Type header
		// that wasn't included in the signature calculation, OSS returns 403
		// SignatureDoesNotMatch. Omitting Content-Type keeps it consistent with
		// how Alipan generated the pre-signed URL.
		for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
			const response = await requestUrl({
				url: uploadUrl,
				method: 'PUT',
				body: content,
				throw: false,
			})

			if (response.status === 403 && attempt < MAX_429_RETRIES) {
				// Pre-signed URL signature mismatch or expired — log and retry
				// with a brief delay (the URL may have expired while waiting in queue)
				logger.warn(
					`Alipan upload part got 403, retrying (attempt ${attempt + 1}/${MAX_429_RETRIES}): ${response.text?.substring(0, 200)}`,
				)
				await sleep(1000 * (attempt + 1))
				continue
			}

			if (response.status >= 400) {
				throw new Error(
					`Alipan upload part failed [${response.status}]: ${response.text}`,
				)
			}

			return // success
		}

		throw new Error(
			`Alipan upload part failed: exhausted ${MAX_429_RETRIES} retries on 403 errors`,
		)
	}

	// ========================
	// Download (GET from download_url)
	// ========================

	async downloadFromUrl(downloadUrl: string): Promise<ArrayBuffer> {
		const response = await requestUrl({
			url: downloadUrl,
			method: 'GET',
			throw: false,
		})

		if (response.status >= 400) {
			throw new Error(
				`Alipan download failed [${response.status}]: ${response.text}`,
			)
		}

		return response.arrayBuffer
	}

	// ========================
	// Delta / Incremental Sync
	// ========================

	async listDelta(req: AlipanListDeltaRequest): Promise<AlipanListDeltaResponse> {
		return this.request<AlipanListDeltaResponse>('/adrive/v1.0/openFile/list_delta', req)
	}

	async getLastCursor(req: AlipanGetLastCursorRequest): Promise<AlipanGetLastCursorResponse> {
		return this.request<AlipanGetLastCursorResponse>('/adrive/v1.0/openFile/get_last_cursor', req)
	}
}
