import { Show } from "solid-js";
import { useAuth } from "../auth/context.tsx";
import LandingPage from "./LandingPage.tsx";
import HomePage from "./HomePage.tsx";

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
