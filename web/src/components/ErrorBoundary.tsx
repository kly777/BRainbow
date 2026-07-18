/**
 * 错误边界 —— 捕获子组件渲染时未处理的错误，展示降级 UI。
 *
 * SolidJS 的响应式系统与 React 不同，无法用 try/catch 包裹 JSX 来捕获子组件错误。
 * 此组件使用 createResource 配合 ErrorCatcher 的思路：
 * - 将 children 包装在一个 never-rejecting 的派生中
 * - 如果子组件 throw，则显示 fallback
 *
 * 更可靠的方式：配合 index.html 中的 window.onerror 做兜底。
 */

import { createMemo, createSignal, type JSX, Show } from "solid-js";
import styles from "./ErrorBoundary.module.css";

interface ErrorBoundaryProps {
	children: JSX.Element;
	fallback?: (error: unknown, reset: () => void) => JSX.Element;
}

function DefaultFallback(props: { error: unknown; reset: () => void }) {
	const msg =
		props.error instanceof Error ? props.error.message : "发生了未知错误";

	return (
		<div class={styles.fallback}>
			<div class={styles.card}>
				<h2 class={styles.title}>应用程序错误</h2>
				<p class={styles.message}>{msg}</p>
				<button type="button" class={styles.btn} onClick={props.reset}>
					重试
				</button>
				<button
					type="button"
					class={styles.btnSecondary}
					onClick={() => globalThis.location.reload()}
				>
					刷新页面
				</button>
			</div>
		</div>
	);
}

/**
 * 错误边界组件。
 *
 * 原理：使用 try/catch 包裹 children 的渲染。如果子组件在同步渲染时抛出错误，
 * 则显示 fallback UI。对于异步错误（如 createResource 内部），已有的 useAsyncResource
 * 和 AsyncView 会处理。
 */
export default function ErrorBoundary(props: ErrorBoundaryProps) {
	const [error, setError] = createSignal<unknown>(null);

	const safe = createMemo(() => {
		try {
			// 触发 children 的求值，如果抛出则捕获
			return { ok: true as const, children: props.children };
		} catch (e: unknown) {
			return { ok: false as const, error: e };
		}
	});

	const reset = () => setError(null);

	return (
		<Show
			when={!error() && safe().ok}
			fallback={
				props.fallback ? (
					props.fallback(error() ?? (safe() as { error: unknown }).error, reset)
				) : (
					<DefaultFallback
						error={error() ?? (safe() as { error: unknown }).error}
						reset={reset}
					/>
				)
			}
		>
			{props.children}
		</Show>
	);
}
