import { Button, ConfirmModalContainer, ToastContainer } from "@components/ui";
import { PATHS } from "@config/paths";
import { AiSettingsModal } from "@modules/ai-setting";
import { AuthDialog, AuthGuard } from "@modules/auth";
import { CommandPalette } from "@modules/command-palette";
import { QuickCapture } from "@modules/quick-capture";
import { getErrorMessage } from "@shared/api";
import { dismissAllConfirms } from "@shared/utils/confirmStore.ts";
import { useLocation } from "@solidjs/router";
import { createEffect, ErrorBoundary, type JSX, Show, untrack } from "solid-js";
import styles from "./App.module.css";
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
			<main class={styles.content}>
				{/* 错误边界：本仓库此前没有任何兜底，任一组件渲染期抛错都会白屏。
				    同时它也让"resource fetcher 抛错"这类失败至少是可见的
				    （fetch 抛错请改用错误信号，见 useListResource 的说明）。 */}
				<ErrorBoundary
					fallback={(err, reset) => (
						<div class={styles.crash}>
							<p class={styles.crashText}>页面出错了：{getErrorMessage(err)}</p>
							<Button variant="secondary" size="sm" onClick={reset}>
								重试
							</Button>
						</div>
					)}
				>
					<Show
						when={isPublic()}
						fallback={<AuthGuard>{props.children}</AuthGuard>}
					>
						{props.children}
					</Show>
				</ErrorBoundary>
			</main>
			<AuthDialog />
			<CommandPalette />
			<QuickCapture />
			<ToastContainer />
			<ConfirmModalContainer />
			<AiSettingsModal />
		</div>
	);
}
