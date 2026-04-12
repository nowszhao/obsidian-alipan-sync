import { App, Modal } from 'obsidian'
import AlipanSyncPlugin from '..'

import { mount as mountRemoteExplorer } from 'remote-explorer'
import { stdRemotePath } from '~/utils/std-remote-path'

export default class SelectRemoteBaseDirModal extends Modal {
	constructor(
		app: App,
		private plugin: AlipanSyncPlugin,
		private onConfirm: (path: string) => void,
	) {
		super(app)
	}

	async onOpen() {
		const { contentEl } = this

		const explorer = document.createElement('div')
		contentEl.appendChild(explorer)

		const storage = await this.plugin.createRemoteStorage?.()

		mountRemoteExplorer(explorer, {
			fs: {
				ls: async (target) => {
					if (!storage) {
						throw new Error('Remote storage not available')
					}
					const items = await storage.getDirectoryContents(target)
					return items.map(item => ({
						path: item.path,
						basename: item.basename,
						isDir: item.isDir,
						isDeleted: item.isDeleted,
						mtime: item.mtime,
						size: item.isDir ? 0 : item.size,
					}))
				},
				mkdirs: async (path) => {
					if (!storage) {
						throw new Error('Remote storage not available')
					}
					await storage.createDirectory(path, { recursive: true })
				},
			},
			onClose: () => {
				explorer.remove()
				this.close()
			},
			onConfirm: async (path) => {
				await Promise.resolve(this.onConfirm(stdRemotePath(path)))
				explorer.remove()
				this.close()
			},
		})
	}

	onClose() {
		const { contentEl } = this
		contentEl.empty()
	}
}
