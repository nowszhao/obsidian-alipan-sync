import * as i18n from '@solid-primitives/i18n';
export type Locale = 'zh' | 'en';
export declare function toLocale(language: string): "zh" | "en";
export declare const locale: import("solid-js").Accessor<Locale>, setLocale: import("solid-js").Setter<Locale>;
export declare const t: i18n.NullableTranslator<{
    readonly newFolder: string;
    readonly goBack: string;
    readonly confirm: string;
    readonly cancel: string;
    readonly currentPath: string;
}, string>;
