import { TFile, Vault } from 'obsidian'
import { sha1Hex } from './sha256'

// 阈值：超过此大小的文件不算本地 hash（大文件降级，防手机端读全文件卡顿）
export const CONTENT_HASH_LIMIT = 100*1024 * 1024 // 100MB，可调/可配

// 本地文件 sha1；超过阈值返回 undefined（降级，不读全文件）
export async function localFileSha1(
	vault: Vault,
	file: TFile,
	limit: number = CONTENT_HASH_LIMIT,
): Promise<string | undefined> {
	if (file.stat.size > limit) return undefined
	const buf = await vault.readBinary(file)
	return await sha1Hex(buf)
}