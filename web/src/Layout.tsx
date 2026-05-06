import { A } from "@solidjs/router";
import { createSignal, type JSX } from "solid-js";
import AuthStatus from "./AuthStatus";
import ToastContainer from "./components/Toast";
import styles from "./App.module.css";

export default function Layout(props: { children?: JSX.Element }) {
	const [menuOpen, setMenuOpen] = createSignal(false);

	const closeMenu = () => setMenuOpen(false);

	return (
		<div class={styles.shell}>
			{/* 移动端顶栏 */}
			<header class={styles.topBar}>
				<button
					type="button"
					class={styles.hamburger}
					onClick={() => setMenuOpen(!menuOpen())}
				>
					{menuOpen() ? "✕" : "☰"}
				</button>
				<h1 class={styles.brand}>
					Brain<span>bow</span>
				</h1>
			</header>

			{/* 侧边栏（桌面端常显，移动端通过 menuOpen 控制） */}
			<aside
				class={styles.sidebar}
				classList={{ [styles.sidebarOpen]: menuOpen() }}
			>
				<h1 class={styles.sidebarBrand}>
					Brain<span>bow</span>
				</h1>
				<nav class={styles.nav}>
					<A href="/" class={styles.navLink} activeClass={styles.active} end onClick={closeMenu}>
						<span class={styles.navIcon}>🏠</span>
						主页
					</A>
					<A href="/tasks" class={styles.navLink} activeClass={styles.active} end onClick={closeMenu}>
						<span class={styles.navIcon}>✅</span>
						任务
					</A>
					<A href="/c" class={styles.navLink} activeClass={styles.active} end onClick={closeMenu}>
						<span class={styles.navIcon}>📝</span>
						卡片
					</A>
					<A href="/i" class={styles.navLink} activeClass={styles.active} end onClick={closeMenu}>
						<span class={styles.navIcon}>🖼️</span>
						图片
					</A>
					<A href="/o" class={styles.navLink} activeClass={styles.active} end onClick={closeMenu}>
						<span class={styles.navIcon}>🔗</span>
						本体
					</A>
				</nav>
				<div class={styles.sidebarFooter}>
					<AuthStatus />
				</div>
			</aside>

			{/* 遮罩（移动端点击关闭） */}
			<button
				type="button"
				class={styles.overlay}
				classList={{ [styles.overlayVisible]: menuOpen() }}
				onClick={closeMenu}
				aria-label="关闭侧边菜单"
			/>

			{/* 主内容区 */}
			<main class={styles.content}>{props.children}</main>

			{/* 全局 Toast 通知 */}
			<ToastContainer />
		</div>
	);
}
