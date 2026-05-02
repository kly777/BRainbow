import { A } from "@solidjs/router";
import { createSignal, type JSX } from "solid-js";
import AuthStatus from "./AuthStatus";
import styles from "./App.module.css";

export default function Layout(props: { children?: JSX.Element }) {
	const [menuOpen, setMenuOpen] = createSignal(false);

	return (
		<div class={styles.appContainer}>
			<header class={styles.appHeader}>
				<div class={styles.headerContent}>
					<h1 class={styles.appTitle}>
						Brain<span>bow</span>
					</h1>
					<nav class={`${styles.navLinks} ${menuOpen() ? styles.navOpen : ""}`}>
						<A
							href="/"
							class={styles.navLink}
							activeClass={styles.active}
							end
							onClick={() => setMenuOpen(false)}
						>
							主页
						</A>
						<A
							href="/tasks"
							class={styles.navLink}
							activeClass={styles.active}
							end
							onClick={() => setMenuOpen(false)}
						>
							任务
						</A>
						<A
							href="/c"
							class={styles.navLink}
							activeClass={styles.active}
							end
							onClick={() => setMenuOpen(false)}
						>
							卡片
						</A>
						<A
							href="/o"
							class={styles.navLink}
							activeClass={styles.active}
							end
							onClick={() => setMenuOpen(false)}
						>
							本体
						</A>
						<AuthStatus />
					</nav>
					<button
						type="button"
						class={styles.hamburger}
						onClick={() => setMenuOpen(!menuOpen())}
					>
						{menuOpen() ? "✕" : "☰"}
					</button>
				</div>
			</header>
			<main class={styles.appContent}>{props.children}</main>
		</div>
	);
}
