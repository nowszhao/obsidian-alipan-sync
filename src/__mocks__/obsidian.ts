// Minimal obsidian mock for unit testing
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class Modal {}
export class Plugin {}
export class Vault {}
export class TFile {}
export class TFolder {}
export class TAbstractFile {}
export class Component {}
export class App {}
export class Platform {
	static isDesktopApp = true
	static isMobileApp = false
	static isAndroidApp = false
	static isMobile = false
}
export const normalizePath = (p: string) => p
export const moment = () => ({
	format: () => '',
})
export const requireApiVersion = () => false
export const apiVersion = '1.0.0'
export const API_VER_REQURL = '0.0.0'
