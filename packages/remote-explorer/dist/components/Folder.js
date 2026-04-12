import * as __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__ from "solid-js/web";
var _tmpl$ = /*#__PURE__*/ (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.template)('<div class="flex gap-2 items-center max-w-full hover:bg-[var(--interactive-accent)] border-rounded px-1"><div class="i-custom:folder size-10"></div><span class="truncate flex-1">');
function Folder(props) {
    return (()=>{
        var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
        _el$.$$click = ()=>props.onClick(props.path);
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$3, ()=>props.name);
        return _el$;
    })();
}
const Folder_rslib_entry_ = Folder;
(0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.delegateEvents)([
    "click"
]);
export { Folder_rslib_entry_ as default };
