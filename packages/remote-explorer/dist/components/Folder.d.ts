export interface FolderProps {
    name: string;
    path: string;
    onClick: (path: string) => void;
}
declare function Folder(props: FolderProps): import("solid-js").JSX.Element;
export default Folder;
