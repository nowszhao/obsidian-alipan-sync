import * as __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__ from "solid-js/web";
import * as __WEBPACK_EXTERNAL_MODULE_obsidian__ from "obsidian";
import * as __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__ from "solid-js";
import * as __WEBPACK_EXTERNAL_MODULE__File_js_d0f173cc__ from "./File.js";
import * as __WEBPACK_EXTERNAL_MODULE__Folder_js_3f0292b4__ from "./Folder.js";
function createFileList() {
    const [version, setVersion] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)(0);
    return {
        refresh () {
            setVersion((v)=>++v);
        },
        FileList (props) {
            const [items, setItems] = (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createSignal)([]);
            const sortedItems = ()=>items().sort((a, b)=>{
                    if (a.isDir === b.isDir) return a.basename.localeCompare(b.basename, [
                        'zh'
                    ]);
                    if (a.isDir && !b.isDir) return -1;
                    return 1;
                });
            async function refresh() {
                try {
                    const items = await props.fs.ls(props.path);
                    setItems(items);
                } catch (e) {
                    if (e instanceof Error) new __WEBPACK_EXTERNAL_MODULE_obsidian__.Notice(e.message);
                }
            }
            (0, __WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.createEffect)(async ()=>{
                if (0 === version()) {
                    await refresh();
                    return;
                }
                setVersion(0);
            });
            return (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.For, {
                get each () {
                    return sortedItems();
                },
                children: (f)=>(0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE_solid_js_aeefcc6d__.Show, {
                        get when () {
                            return f.isDir;
                        },
                        get fallback () {
                            return (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE__File_js_d0f173cc__["default"], {
                                get name () {
                                    return f.basename;
                                }
                            });
                        },
                        get children () {
                            return (0, __WEBPACK_EXTERNAL_MODULE_solid_js_web_35d951b7__.createComponent)(__WEBPACK_EXTERNAL_MODULE__Folder_js_3f0292b4__["default"], {
                                get name () {
                                    return f.basename;
                                },
                                get path () {
                                    return f.path;
                                },
                                onClick: ()=>props.onClick(f)
                            });
                        }
                    })
            });
        }
    };
}
export { createFileList };
