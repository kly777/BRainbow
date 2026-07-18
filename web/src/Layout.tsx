import type { JSX } from "solid-js";
import styles from "./App.module.css";
import AuthStatus from "./auth/AuthStatus.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import ConfirmModalContainer from "./components/ui/ConfirmModal.tsx";
import ToastContainer from "./components/ui/Toast.tsx";
import { RouteTitle } from "./routes.ts";

export default function Layout(props: { children?: JSX.Element }) {
	return (
		<div class={styles.shell}>
			<RouteTitle />
			<main class={styles.content}>{props.children}</main>
			<AuthStatus />
			<CommandPalette />
			<ToastContainer />
			<ConfirmModalContainer />
		</div>
	);
}
