import { useLocation } from "@solidjs/router";
import { createEffect, onMount, type JSX } from "solid-js";
import { AUTH_REQUIRED_EVENT } from "./apis/request.ts";
import styles from "./App.module.css";
import AuthStatus from "./auth/AuthStatus.tsx";
import { getToken } from "./auth/context.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import ConfirmModalContainer from "./components/ui/ConfirmModal.tsx";
import ToastContainer from "./components/ui/Toast.tsx";
import { RouteTitle } from "./routes.ts";

export default function Layout(props: { children?: JSX.Element }) {
	const location = useLocation();

	// 主动检测：无 token 且非首页 → 立即弹出登录框，不等 API 401
	let checked = false;
	onMount(() => {
		if (!getToken() && location.pathname !== "/") {
			globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
		}
		checked = true;
	});

	// 已登录用户在页面间导航时，如果 token 过期被清除，也弹出登录框
	createEffect(() => {
		if (!checked) return;
		void location.pathname;
		if (!getToken() && location.pathname !== "/") {
			globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
		}
	});

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
