interface NewFolderProps {
    class?: string;
    onConfirm: (name: string) => void;
    onCancel: () => void;
}
declare function NewFolder(props: NewFolderProps): import("solid-js").JSX.Element;
export default NewFolder;
