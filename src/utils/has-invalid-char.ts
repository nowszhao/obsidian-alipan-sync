/**
 * Characters that are invalid for the Alipan (阿里云盘) API file names.
 *
 * Only path separators and control characters are truly rejected by the API.
 * Windows-specific restrictions ( : * ? " < > | ) are NOT enforced here because:
 *   - The Alipan API allows them in file names.
 *   - macOS and Linux file systems also allow them.
 *   - On Windows, Obsidian itself prevents creating files with these characters,
 *     so a sync failure at the OS level would surface as a clear file-system error.
 */
const INVALID_CHARS = '\\/\t\r\n'
const INVALID_CHARS_LIST = INVALID_CHARS.split('')

/**
 * Extract the basename (last segment after the final / or \) from a path.
 * The caller may pass full relative paths (e.g. "dir/subdir/file.md"),
 * but only the actual file/directory name should be checked for invalid characters.
 */
function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path
}

export function hasInvalidChar(str: string) {
	return INVALID_CHARS_LIST.some((c) => basename(str).includes(c))
}

export function getInvalidChars(str: string): string[] {
	return INVALID_CHARS_LIST.filter((c) => basename(str).includes(c))
}
