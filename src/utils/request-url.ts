import {
	Platform,
	requestUrl as req,
	RequestUrlParam,
	RequestUrlResponse,
} from 'obsidian'
import { PLUGIN_VERSION } from '~/consts'
import logger from './logger'

const getOS = () => {
	if (Platform.isWin) return 'Windows'
	if (Platform.isMacOS) return 'macOS'
	if (Platform.isLinux) return 'Linux'
	if (Platform.isAndroidApp) return 'Android'
	if (Platform.isIosApp) return 'iOS'
	return 'Unknown'
}

const getDevice = () => {
	if (Platform.isTablet) return 'Tablet'
	if (Platform.isPhone) return 'Phone'
	if (Platform.isDesktopApp) return 'Desktop'
	if (Platform.isMobileApp) return 'Mobile'
	return 'Unknown'
}

const USER_AGENT = `Obsidian (${getOS()}; ${getDevice()}; ObsidianAlipanSync/${PLUGIN_VERSION})`

class RequestUrlError extends Error {
	constructor(public res: RequestUrlResponse) {
		super(`${res.status}: ${res.text}`)
	}
}

export default async function requestUrl(p: RequestUrlParam | string) {
	const shouldThrow = typeof p === 'string' || p.throw !== false
	const url = typeof p === 'string' ? p : p.url
	const params: RequestUrlParam =
		typeof p === 'string'
			? {
					url: p,
					throw: false,
				}
			: {
					...p,
					throw: false,
					headers: {
						...(p.headers || {}),
					},
				}

	let res: RequestUrlResponse
	try {
		res = await req(params)
	} catch (err: unknown) {
		// Obsidian's native requestUrl may throw even when throw: false is set.
		// Try to extract the response from the error object so callers with
		// throw: false can still inspect the status code.
		const maybeRes = (err as Record<string, unknown> | null)
		if (
			maybeRes &&
			typeof maybeRes.status === 'number' &&
			maybeRes.headers
		) {
			// The error itself acts as a response-like object
			res = maybeRes as unknown as RequestUrlResponse
		} else if (!shouldThrow) {
			// Cannot recover a response — synthesize a minimal one so callers
			// that opted into throw: false don't crash.
			logger.error(`[requestUrl] network error: url=${url}`, err)
			res = {
				status: 0,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: null,
				text: String(err),
			} as unknown as RequestUrlResponse
		} else {
			logger.error(`[requestUrl] network error: url=${url}`, err)
			throw err
		}
	}

	if (res.status >= 400) {
		logger.error(`[requestUrl] HTTP ${res.status}: ${url}`)
		if (shouldThrow) {
			throw new RequestUrlError(res)
		}
	}

	return res
}
