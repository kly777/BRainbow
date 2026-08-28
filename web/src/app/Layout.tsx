import { ConfirmModalContainer, ToastContainer } from "@components/ui";
import { dismissAllConfirms } from "@components/ui/organisms/confirmStore.ts";
import { PATHS } from "@config/paths";
import { AiSettingsModal } from "@modules/ai-setting";
import { AuthDialog, AuthGuard } from "@modules/auth";
import { CommandPalette } from "@modules/command-palette";
import { useLocation } from "@solidjs/router";
import { createEffect, type JSX, Show, untrack } from "solid-js";
import styles from "./App.module.css";
import NavBar from "./NavBar.tsx";
import { RouteTitle } from "./routes.ts";

export default function Layout(props: { children?: JSX.Element }) {
	const location = useLocation();
	// 首页公开（HomeGuard 自行切换着陆页/仪表盘），其余路由均需认证
	const isPublic = () => location.pathname === PATHS.home;

	// 路由切换时关闭残留的确认框（dismissAllConfirms 注释声称的用途）。
	// untrack：dismissAllConfirms 内部读写 items 信号，若纳入追踪会自触发死循环。
	createEffect(() => {
		void location.pathname;
		untrack(() => dismissAllConfirms());
	});

	return (
		<div class={styles.shell}>
			<RouteTitle />
			<NavBar />
			<main class={styles.content}>
				<Show
					when={isPublic()}
					fallback={<AuthGuard>{props.children}</AuthGuard>}
				>
					{props.children}
				</Show>
			</main>
			<AuthDialog />
			<CommandPalette />
			<ToastContainer />
			<ConfirmModalContainer />
			<AiSettingsModal />
		</div>
	);
}
