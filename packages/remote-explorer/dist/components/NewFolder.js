import * as __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__ from "solid-js/web";
import * as __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__ from "solid-js";
import * as __WEBPACK_EXTERNAL_MODULE__i18n_index_js_301a0894__ from "../i18n/index.js";
var _tmpl$ = /*#__PURE__*/ (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.template)('<div><div class="i-custom:folder size-10"></div><input type=text class=flex-1 autofocus><button></button><button>');
function NewFolder(props) {
    const [name, setName] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)('');
    const className = ()=>`flex items-center gap-2 px-1 ${props.class}`;
    return (()=>{
        var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.nextSibling, _el$5 = _el$4.nextSibling;
        _el$3.$$input = (e)=>setName(e.target.value);
        _el$4.$$click = ()=>props.onConfirm(name());
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$4, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_301a0894__.t)('confirm'));
        _el$5.$$click = ()=>props.onCancel();
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$5, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_301a0894__.t)('cancel'));
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.effect)(()=>(0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.className)(_el$, className()));
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.effect)(()=>_el$3.value = name());
        return _el$;
    })();
}
const NewFolder_rslib_entry_ = NewFolder;
(0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.delegateEvents)([
    "input",
    "click"
]);
export { NewFolder_rslib_entry_ as default };
