import { ConfirmModalContainer, ToastContainer } from "@components/ui";
import { AiSettingsModal } from "@modules/ai-setting";
import { AuthDialog, AuthGuard } from "@modules/auth";
import { CommandPalette } from "@modules/command-palette";
import { useLocation } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import styles from "./App.module.css";
import { RouteTitle } from "./routes.ts";

export default function Layout(props: { children?: JSX.Element }) {
	const location = useLocation();
	// 首页公开（HomeGuard 自行切换着陆页/仪表盘），其余路由均需认证
	const isPublic = () => location.pathname === "/";

	return (
		<div class={styles.shell}>
			<RouteTitle />
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
