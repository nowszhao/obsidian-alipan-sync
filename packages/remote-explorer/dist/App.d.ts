import { FileStat } from './components/FileList';
type MaybePromise<T> = Promise<T> | T;
export interface fs {
    ls: (path: string) => MaybePromise<FileStat[]>;
    mkdirs: (path: string) => MaybePromise<void>;
}
export interface AppProps {
    fs: fs;
    onConfirm: (path: string) => void;
    onClose: () => void;
}
declare function App(props: AppProps): import("solid-js").JSX.Element;
export default App;
