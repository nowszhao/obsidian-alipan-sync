import { type fs } from '../App';
export interface FileStat {
    path: string;
    basename: string;
    isDir: boolean;
}
export interface FileListProps {
    path: string;
    fs: fs;
    onClick: (file: FileStat) => void;
}
export declare function createFileList(): {
    refresh(): void;
    FileList(props: FileListProps): import("solid-js").JSX.Element;
};
