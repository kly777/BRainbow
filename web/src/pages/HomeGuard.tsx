import { useAuth } from "@app/auth/context.tsx";
import HomePage from "@pages/HomePage.tsx";
import LandingPage from "@pages/LandingPage.tsx";
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
