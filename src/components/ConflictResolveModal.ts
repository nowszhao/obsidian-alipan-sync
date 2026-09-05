import { App, Modal, Setting } from 'obsidian'
import i18n from '../i18n'
import { StatModel } from '../model/stat.model'

export type ConflictChoice = 'local' | 'remote' | 'skip'

export default class ConflictResolveModal extends Modal {
	private choice: ConflictChoice = 'skip'
	constructor(
		app: App,
		private localPath: string,
		private remotePath: string,
		private localStat?: StatModel,
		private remoteStat?: StatModel,
		private localHash?:string,
		private remoteHash?:string,
	) {
		super(app)
	}

	onOpen() {
		this.setTitle(i18n.t('conflictResolve.title'))
		const { contentEl } = this
		contentEl.empty()

		const instruction = contentEl.createEl('p', { cls: 'alipan-text-prewrap' })
		instruction.setText(i18n.t('conflictResolve.instruction'))

		// 格式化工具
		const fmtTime = (ts?: number) =>
			ts ? window.moment(ts).format('YYYY-MM-DD HH:mm:ss') : '—'
		const fmtSize = (size?: number) => {
			if (size === undefined) return '—'
			if (size < 1024) return `${size} B`
			if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
			return `${(size / 1024 / 1024).toFixed(2)} MB`
			
		}
		const sizeOf = (s?: StatModel) => (s && !s.isDir ? s.size : undefined)
		const table = contentEl.createEl('table', { cls: 'conflict-table' })
		const tbody = table.createEl('tbody',{cls:'conflict-table td'})
		const addRow = (label: string, lv: string, rv: string) => {
			const row = tbody.createEl('tr')
			row.createEl('td', { text: label, cls: 'col-path' })
			row.createEl('td', { text: lv, cls: 'col-path' })
			row.createEl('td', { text: rv, cls: 'col-path' })
		}

		// 表头
		addRow('', i18n.t('conflictResolve.localColumn'), i18n.t('conflictResolve.remoteColumn'))
		addRow(i18n.t('conflictResolve.pathColumn'), this.localPath, this.remotePath)
		addRow(i18n.t('conflictResolve.createdColumn'), fmtTime(this.localStat?.ctime), fmtTime(this.remoteStat?.ctime))
		addRow(i18n.t('conflictResolve.modifiedColumn'), fmtTime(this.localStat?.mtime), fmtTime(this.remoteStat?.mtime))
		addRow(i18n.t('conflictResolve.sizeColumn'), fmtSize(sizeOf(this.localStat)), fmtSize(sizeOf(this.remoteStat)))
		addRow(i18n.t('conflictResolve.hashColumn'),this.localHash ? this.localHash.slice(0, 10) : '—',this.remoteHash ? this.remoteHash.slice(0, 10) : '—')
		
		// 一致性结论
		const hint = contentEl.createEl('p', { cls: 'alipan-text-prewrap' })
		const same = (this.localHash && this.remoteHash && this.localHash === this.remoteHash&&this.localHash!=undefined&&this.remoteHash!=undefined) 
		hint.setText(
			same
				? i18n.t('conflictResolve.hashSame')
				: (this.localHash && this.remoteHash)
					? i18n.t('conflictResolve.hashDiff')
					: i18n.t('conflictResolve.hashMissing'),
		)
		const settingDiv = contentEl.createDiv({ cls: 'alipan-mt-1' })
		new Setting(settingDiv)
			.addButton((button) => {
				button
					.setButtonText(i18n.t('conflictResolve.useLocal'))
					.setCta()
					.onClick(() => { this.choice = 'local'; this.close() })
			})
			.addButton((button) => {
				button
					.setButtonText(i18n.t('conflictResolve.useRemote'))
					.onClick(() => { this.choice = 'remote'; this.close() })
			})
			.addButton((button) => {
				button
					.setButtonText(i18n.t('conflictResolve.skip'))
					.onClick(() => { this.choice = 'skip'; this.close() })
			})
	}
	async open(): Promise<ConflictChoice> {
		super.open()
		return new Promise((resolve) => {
			this.onClose = () => resolve(this.choice)
		})
	}
}