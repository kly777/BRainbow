import { useAuth } from "@entities/user";
import { HomePage } from "@pages/home";
import { LandingPage } from "@pages/landing";
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
