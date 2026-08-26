import { useAuth } from "@app/context/auth.tsx";
import { PATHS } from "@config/paths";
import { AUTH_REQUIRED_EVENT } from "@shared/api";
import { createEffect, type JSX, Show } from "solid-js";
import styles from "./AuthStatus.module.css";

/**
 * 路由守卫：未登录时渲染「需要登录」提示页（而非空白），并触发登录弹窗。
 *
 * 与「API 401 后被动弹窗」的区别：
 * - 页面组件根本不挂载 → 零 API 请求、零 401、无空页面闪烁
 * - lazy 路由组件也不会被加载 → 未登录用户不下载页面 chunk
 * - 提示页持久可见：关闭弹窗后用户仍能明确得知需要登录
 *
 * 登录成功后 auth() 响应式更新，子组件自动挂载，无需刷新。
 */
export default function AuthGuard(props: { children: JSX.Element }) {
	const { auth } = useAuth();
	// 防循环：logout() 产生新 auth 对象会重新触发 effect，只 dispatch 一次
	let notified = false;

	const isAuthed = () => Boolean(auth().user || auth().apiKey);

	createEffect(() => {
		if (isAuthed()) {
			notified = false;
			return;
		}
		if (!notified) {
			notified = true;
			globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
		}
	});

	return (
		<Show
			when={isAuthed()}
			fallback={
				<div class={styles.authRequired}>
					<h1 class={styles.authRequiredTitle}>需要登录</h1>
					<p class={styles.authRequiredDesc}>此页面需要登录后才能访问</p>
					<button
						type="button"
						class={styles.authRequiredBtn}
						onClick={() =>
							globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT))
						}
					>
						登录
					</button>
					<a href={PATHS.home} class={styles.authRequiredLink}>
						返回首页
					</a>
				</div>
			}
		>
			{props.children}
		</Show>
	);
}
