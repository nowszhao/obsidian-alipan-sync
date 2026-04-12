import { dirname } from 'path-browserify'
import logger from '~/utils/logger'
import { mkdirsVault } from '~/utils/mkdirs-vault'
import { BaseTask, BaseTaskOptions, toTaskError } from './task.interface'

export default class PullTask extends BaseTask {
	constructor(
		readonly options: BaseTaskOptions & {
			remoteSize: number
		},
	) {
		super(options)
	}

	get remoteSize() {
		return this.options.remoteSize
	}

	async exec() {
		const fileExists = await this.vault.getFileByPath(this.localPath)
		try {
			if (!this.remoteStorage) {
				throw new Error('Remote storage not available')
			}

			const file = await this.remoteStorage.getFileContents(this.remotePath)
			const arrayBuffer = file instanceof ArrayBuffer
				? file
				: bufferLikeToArrayBuffer(file)

			if (arrayBuffer.byteLength !== this.remoteSize) {
				throw new Error('Remote Size Not Match!')
			}
			if (fileExists) {
				await this.vault.modifyBinary(fileExists, arrayBuffer)
			} else {
				await mkdirsVault(this.vault, dirname(this.localPath))
				await this.vault.createBinary(this.localPath, arrayBuffer)
			}
			return { success: true } as const
		} catch (e) {
			logger.error(this, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}
}

function bufferLikeToArrayBuffer(buffer: ArrayBuffer | Buffer): ArrayBuffer {
	if (buffer instanceof ArrayBuffer) {
		return buffer
	} else {
		return toArrayBuffer(buffer)
	}
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
	if (buf.buffer instanceof SharedArrayBuffer) {
		const copy = new ArrayBuffer(buf.byteLength)
		new Uint8Array(copy).set(buf)
		return copy
	}
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
