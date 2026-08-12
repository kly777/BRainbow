import HomePage from "@app/pages/home/HomePage.tsx";
import LandingPage from "@app/pages/landing/LandingPage.tsx";
import { useAuth } from "@modules/auth";
import { Show } from "solid-js";

/**
 * 首页守卫：未登录 → 着陆页，已登录 → 主页仪表盘
 */
export default function HomeGuard() {
	const { auth } = useAuth();

	return (
		<Show when={auth().user} fallback={<LandingPage />}>
			<HomePage />
		</Show>
	);
}
