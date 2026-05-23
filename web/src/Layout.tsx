import type { JSX } from "solid-js";
import CommandPalette from "./components/CommandPalette.tsx";
import ToastContainer from "./components/ui/Toast.tsx";
import styles from "./App.module.css";

export default function Layout(props: { children?: JSX.Element }) {
    return (
        <div class={styles.shell}>
            <main class={styles.content}>{props.children}</main>
            <CommandPalette />
            <ToastContainer />
        </div>
    );
}
