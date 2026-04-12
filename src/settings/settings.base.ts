import { App } from 'obsidian'
import { AlipanSettingTab } from '.'
import AlipanSyncPlugin from '..'

export default abstract class BaseSettings {
	constructor(
		protected app: App,
		protected plugin: AlipanSyncPlugin,
		protected settings: AlipanSettingTab,
		public containerEl: HTMLElement,
	) {}

	abstract display(): void
}
