import { PATHS } from "@config/paths";
import { A, useLocation } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import styles from "./NavBar.module.css";

interface NavEntry {
	path: string;
	label: string;
	color: string;
}

const NAV_ENTRIES: NavEntry[] = [
	{ path: PATHS.task, label: "任务", color: "var(--m-task)" },
	{ path: PATHS.card, label: "卡片", color: "var(--m-card)" },
	{ path: PATHS.memory, label: "记忆", color: "var(--m-mem)" },
	{ path: PATHS.ontology, label: "本体", color: "var(--m-onto)" },
	{ path: PATHS.conversation, label: "搜索", color: "var(--m-search)" },
	{ path: PATHS.chat, label: "AI", color: "var(--m-chat)" },
	{ path: PATHS.bookmark, label: "书签", color: "var(--m-bookmark)" },
	{
		path: PATHS.reading,
		label: "阅读",
		color: "var(--m-reading, var(--m-text))",
	},
	{ path: PATHS.text, label: "文本", color: "var(--m-text)" },
	{ path: PATHS.image, label: "图片", color: "var(--m-image)" },
];

function isActive(locationPath: string, entryPath: string): boolean {
	if (entryPath === PATHS.task) {
		return locationPath === PATHS.task || locationPath.startsWith("/task/");
	}
	return locationPath === entryPath || locationPath.startsWith(`${entryPath}/`);
}

export default function NavBar() {
	const location = useLocation();
	const [mobileOpen, setMobileOpen] = createSignal(false);

	const isHome = () => location.pathname === PATHS.home;

	return (
		<Show when={!isHome()}>
			<nav class={styles.navbar}>
				<A href={PATHS.home} class={styles.brand}>
					<div class={styles.brandIcon} aria-hidden="true" />
					Brainbow
				</A>

				<div class={styles.links}>
					<For each={NAV_ENTRIES}>
						{(entry) => (
							<A
								href={entry.path}
								class={`${styles.link} ${isActive(location.pathname, entry.path) ? styles.linkActive : ""}`}
							>
								<span
									class={styles.linkDot}
									style={{ background: entry.color }}
									aria-hidden="true"
								/>
								{entry.label}
							</A>
						)}
					</For>
				</div>

				<button
					type="button"
					class={styles.menuBtn}
					onClick={() => setMobileOpen(true)}
					aria-label="打开导航菜单"
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M3 12h18M3 6h18M3 18h18" />
					</svg>
				</button>
			</nav>

			{/* Mobile overlay — rendered outside nav to avoid stacking context issues */}
			<Show when={mobileOpen()}>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: 关闭由点击overlay处理 */}
				<div
					class={`${styles.mobileOverlay} ${styles.open}`}
					onClick={() => setMobileOpen(false)}
					role="dialog"
					aria-modal="true"
					aria-label="导航菜单"
					tabIndex={-1}
				>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: 仅阻止冒泡防点内误关 */}
					<div
						class={styles.mobilePanel}
						onClick={(e) => e.stopPropagation()}
						role="document"
					>
						<button
							type="button"
							class={styles.mobileClose}
							onClick={() => setMobileOpen(false)}
							aria-label="关闭导航菜单"
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M18 6L6 18M6 6l12 12" />
							</svg>
						</button>
						<A
							href={PATHS.home}
							class={styles.link}
							onClick={() => setMobileOpen(false)}
						>
							首页
						</A>
						<For each={NAV_ENTRIES}>
							{(entry) => (
								<A
									href={entry.path}
									class={`${styles.link} ${isActive(location.pathname, entry.path) ? styles.linkActive : ""}`}
									onClick={() => setMobileOpen(false)}
								>
									<span
										class={styles.linkDot}
										style={{ background: entry.color }}
										aria-hidden="true"
									/>
									{entry.label}
								</A>
							)}
						</For>
					</div>
				</div>
			</Show>
		</Show>
	);
}
