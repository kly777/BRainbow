import { type JSX, Show, createEffect } from "solid-js";
import { AUTH_REQUIRED_EVENT } from "@apis/request.ts";
import { useAuth } from "@auth/context.tsx";

/**
 * 路由守卫：未登录时不渲染子组件，并触发登录弹窗。
 *
 * 与「API 401 后被动弹窗」的区别：
 * - 页面组件根本不挂载 → 零 API 请求、零 401、无空页面闪烁
 * - lazy 路由组件也不会被加载 → 未登录用户不下载页面 chunk
 *
 * 登录成功后 auth() 响应式更新，子组件自动挂载，无需刷新。
 */
export default function AuthGuard(props: { children: JSX.Element }) {
	const { auth } = useAuth();
	// 防循环：logout() 产生新 auth 对象会重新触发 effect，只 dispatch 一次
	let notified = false;

	createEffect(() => {
		if (auth().user) {
			notified = false;
			return;
		}
		if (!notified) {
			notified = true;
			globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
		}
	});

	return <Show when={auth().user}>{props.children}</Show>;
}
