import { useAuth } from "@app/context/auth.tsx";
import HomePage from "@modules/home/HomePage.tsx";
import LandingPage from "@modules/landing/LandingPage.tsx";
import { Show } from "solid-js";

/**
 * 首页守卫：未登录 → 着陆页，已登录 → 主页仪表盘
 */
export default function HomeGuard() {
	const { auth } = useAuth();
	// 与 AuthGuard 判定保持一致：纯 API Key 场景也算已登录（审计 F9）
	const isAuthed = () => Boolean(auth().user || auth().apiKey);

	return (
		<Show when={isAuthed()} fallback={<LandingPage />}>
			<HomePage />
		</Show>
	);
}
