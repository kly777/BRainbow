import type { JSX } from "solid-js";
import AuthStatus from "./auth/AuthStatus.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import ToastContainer from "./components/ui/Toast.tsx";
import styles from "./App.module.css";

export default function Layout(props: { children?: JSX.Element }) {
	return (
		<div class={styles.shell}>
			<main class={styles.content}>{props.children}</main>
			<AuthStatus />
			<CommandPalette />
			<ToastContainer />
		</div>
	);
}
