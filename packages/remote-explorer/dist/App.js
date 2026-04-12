import * as __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__ from "solid-js/web";
import * as __WEBPACK_EXTERNAL_MODULE_obsidian__ from "obsidian";
import * as __WEBPACK_EXTERNAL_MODULE_path_browserify_848f6234__ from "path-browserify";
import * as __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__ from "solid-js";
import * as __WEBPACK_EXTERNAL_MODULE__components_FileList_js_2436c2f5__ from "./components/FileList.js";
import * as __WEBPACK_EXTERNAL_MODULE__components_NewFolder_js_17421930__ from "./components/NewFolder.js";
import * as __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__ from "./i18n/index.js";
var _tmpl$ = /*#__PURE__*/ (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.template)('<div class="flex-1 flex flex-col overflow-y-auto scrollbar-hide">'), _tmpl$2 = /*#__PURE__*/ (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.template)('<div class="flex flex-col gap-4 h-50vh"><div class="flex gap-2 text-xs"><span>:</span><span class=break-all></span></div><div class="flex items-center gap-2"><button></button><a class=no-underline></a><div class=flex-1></div><button></button><button>');
function App(props) {
    const [stack, setStack] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)([
        '/'
    ]);
    const [showNewFolder, setShowNewFolder] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)(false);
    const cwd = ()=>stack().at(-1);
    function enter(path) {
        setStack((stack)=>[
                ...stack,
                path
            ]);
    }
    function pop() {
        setStack((stack)=>stack.length > 1 ? stack.slice(0, stack.length - 1) : stack);
    }
    const SingleCol = ()=>{
        const list = (0, __WEBPACK_EXTERNAL_MODULE__components_FileList_js_2436c2f5__.createFileList)();
        return (()=>{
            var _el$ = _tmpl$();
            (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$, (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.Show, {
                get when () {
                    return showNewFolder();
                },
                get children () {
                    return (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE__components_NewFolder_js_17421930__["default"], {
                        class: "mt-1",
                        onCancel: ()=>setShowNewFolder(false),
                        onConfirm: async (name)=>{
                            const target = __WEBPACK_EXTERNAL_MODULE_path_browserify_848f6234__["default"].join(cwd() ?? '/', name);
                            await Promise.resolve(props.fs.mkdirs(target)).then(()=>{
                                setShowNewFolder(false);
                                list.refresh();
                            }).catch((e)=>{
                                if (e instanceof Error) new __WEBPACK_EXTERNAL_MODULE_obsidian__.Notice(e.message);
                            });
                        }
                    });
                }
            }), null);
            (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$, (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(list.FileList, {
                get fs () {
                    return props.fs;
                },
                get path () {
                    return cwd() ?? '';
                },
                onClick: (f)=>enter(f.path)
            }), null);
            return _el$;
        })();
    };
    return (()=>{
        var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$4.nextSibling, _el$7 = _el$3.nextSibling, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$9.nextSibling, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling;
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$2, (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(SingleCol, {}), _el$3);
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$4, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__.t)('currentPath'), _el$5);
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$6, ()=>cwd() ?? '/');
        _el$8.$$click = pop;
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$8, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__.t)('goBack'));
        _el$9.$$click = ()=>setShowNewFolder(true);
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$9, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__.t)('newFolder'));
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.addEventListener)(_el$1, "click", props.onClose, true);
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$1, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__.t)('cancel'));
        _el$10.$$click = ()=>props.onConfirm(cwd() ?? '/');
        (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.insert)(_el$10, ()=>(0, __WEBPACK_EXTERNAL_MODULE__i18n_index_js_5dded3f9__.t)('confirm'));
        return _el$2;
    })();
}
const App_rslib_entry_ = App;
(0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.delegateEvents)([
    "click"
]);
export { App_rslib_entry_ as default };
