import * as __WEBPACK_EXTERNAL_MODULE__solid_primitives_i18n_b46cc43f__ from "@solid-primitives/i18n";
import * as __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__ from "solid-js";
import * as __WEBPACK_EXTERNAL_MODULE__locales_en_js_04830452__ from "./locales/en.js";
import * as __WEBPACK_EXTERNAL_MODULE__locales_zh_js_c0cf8367__ from "./locales/zh.js";
function toLocale(language) {
    switch(language.split('-')[0].toLowerCase()){
        case 'zh':
            return 'zh';
        default:
            return 'en';
    }
}
const [i18n_rslib_entry_locale, setLocale] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)(toLocale(navigator.language));
const [dict] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createResource)(i18n_rslib_entry_locale, (locale)=>{
    switch(locale){
        case 'zh':
            return __WEBPACK_EXTERNAL_MODULE__solid_primitives_i18n_b46cc43f__.flatten(__WEBPACK_EXTERNAL_MODULE__locales_zh_js_c0cf8367__["default"]);
        default:
            return __WEBPACK_EXTERNAL_MODULE__solid_primitives_i18n_b46cc43f__.flatten(__WEBPACK_EXTERNAL_MODULE__locales_en_js_04830452__["default"]);
    }
});
const t = __WEBPACK_EXTERNAL_MODULE__solid_primitives_i18n_b46cc43f__.translator(dict);
export { i18n_rslib_entry_locale as locale, setLocale, t, toLocale };
