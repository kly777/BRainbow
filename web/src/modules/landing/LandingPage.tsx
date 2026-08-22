import { PATHS } from "@config/paths";
import { useAuth } from "@modules/auth";
import { A } from "@solidjs/router";
import { For } from "solid-js";
import styles from "./LandingPage.module.css";

// ── 模块数据（icon 用 SVG 路径，PATHS 单一来源） ──
const modules = [
	{
		path: PATHS.task,
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
		title: "\u4EFB\u52A1\u7BA1\u7406",
		desc: "\u5217\u8868\u3001\u770B\u677F\u3001\u65E5\u5386\u3001DAG \u56DB\u79CD\u89C6\u56FE\uFF0C\u7075\u6D3B\u7BA1\u7406\u5F85\u529E\u4E8B\u9879",
		color: "var(--t-color-accent)",
	},
	{
		path: PATHS.card,
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
		title: "\u77E5\u8BC6\u5361\u7247",
		desc: "\u8BB0\u5F55\u77E5\u8BC6\u7247\u6BB5\uFF0C\u6784\u5EFA\u4F60\u7684\u4E2A\u4EBA\u77E5\u8BC6\u5E93",
		color: "oklch(55% 0.13 160deg)",
	},
	{
		path: PATHS.memory,
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
		title: "\u95F4\u9694\u8BB0\u5FC6",
		desc: "\u57FA\u4E8E FSRS \u7B97\u6CD5\u7684\u667A\u80FD\u95F4\u9694\u590D\u4E60\u7CFB\u7EDF",
		color: "oklch(60% 0.12 85deg)",
	},
	{
		path: PATHS.ontology,
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
		title: "\u672C\u4F53\u7CFB\u7EDF",
		desc: "\u7BA1\u7406\u6982\u5FF5\u672C\u4F53\u4E0E\u7B26\u53F7\u5173\u7CFB\uFF0C\u7ED3\u6784\u5316\u601D\u7EF4",
		color: "oklch(50% 0.14 255deg)",
	},
	{
		path: PATHS.conversation,
		icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
		title: "\u77E5\u8BC6\u641C\u7D22",
		desc: "\u641C\u7D22 AI \u5BF9\u8BDD\u5386\u53F2\uFF0C\u5FEB\u901F\u5B9A\u4F4D\u77E5\u8BC6",
		color: "oklch(55% 0.16 25deg)",
	},
	{
		path: PATHS.chat,
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
		title: "AI \u5BF9\u8BDD",
		desc: "\u591A\u8F6E\u5BF9\u8BDD\u3001\u6811\u72B6\u5206\u652F\u3001\u4FEE\u8BA2\u4E0A\u4E0B\u6587",
		color: "oklch(55% 0.12 300deg)",
	},
	{
		path: PATHS.text,
		icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
		title: "\u6587\u672C\u7F16\u8F91",
		desc: "\u591A\u6807\u7B7E\u7EAF\u6587\u672C\u7F16\u8F91\u5668\uFF0C\u9AD8\u6548\u4E66\u5199",
		color: "oklch(45% 0.1 200deg)",
	},
	{
		path: PATHS.bookmark,
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
		title: "\u4E66\u7B7E\u7BA1\u7406",
		desc: "\u6536\u85CF\u548C\u6574\u7406\u7F51\u9875\u4E66\u7B7E",
		color: "oklch(55% 0.1 80deg)",
	},
];

// ── 亮点数据 ──
const highlights = [
	{ value: "FSRS", label: "\u95F4\u9694\u91CD\u590D\u7B97\u6CD5" },
	{ value: "SSE", label: "\u6D41\u5F0F AI \u5BF9\u8BDD" },
	{ value: "3 \u4E3B\u9898", label: "\u7EB8\u5F20 / \u6697\u591C / \u6674\u7A7A" },
	{ value: "\u2318K", label: "\u5168\u5C40\u547D\u4EE4\u9762\u677F" },
];

/** SVG \u56FE\u6807\u7EC4\u4EF6\uFF08Heroicons outline \u98CE\u683C\uFF09 */
function ModuleIcon(props: { d: string; color?: string }) {
	return (
		<svg
			class={styles.featureIcon}
			viewBox="0 0 24 24"
			fill="none"
			stroke={props.color ?? "currentColor"}
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={props.d} />
		</svg>
	);
}

export default function LandingPage() {
	const { auth } = useAuth();

	if (auth().user) return null;

	return (
		<div class={styles.landingPage}>
			{/* ── Hero \u533A ── */}
			<header class={styles.hero}>
				<div class={styles.heroBadge}>\u4E2A\u4EBA\u77E5\u8BC6\u5DE5\u4F5C\u53F0</div>
				<h1 class={styles.heroTitle}>
				\u7528<span class={styles.gradientText}>\u5F69\u8679</span>
				\u7F16\u7EC7\u4F60\u7684\u77E5\u8BC6\u7F51\u7EDC
				</h1>
				<p class={styles.heroSubtitle}>
				Brainbow \u662F\u4E00\u5957\u96C6\u6210\u7684\u4EFB\u52A1\u7BA1\u7406\u3001\u77E5\u8BC6\u5361\u7247\u3001\u95F4\u9694\u8BB0\u5FC6\u3001AI \u5BF9\u8BDD\u548C\u672C\u4F53\u7CFB\u7EDF\u2014\u2014
				\u8BA9\u788E\u7247\u5316\u7684\u77E5\u8BC6\u5F62\u6210\u7ED3\u6784\uFF0C\u8BA9\u601D\u8003\u770B\u5F97\u89C1\u3002
				</p>
				<div class={styles.ctaRow}>
					<button
						type="button"
						class={styles.ctaPrimary}
						onClick={() =>
							globalThis.dispatchEvent(new CustomEvent("auth:required"))
						}
					>
						\u5F00\u59CB\u4F7F\u7528
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M5 12h14M12 5l7 7-7 7" />
						</svg>
					</button>
					<span class={styles.ctaHint}>\u6309 Ctrl+K \u968F\u65F6\u5524\u51FA\u547D\u4EE4\u9762\u677F</span>
				</div>
			</header>

			{/* ── \u4EAE\u70B9\u6761 ── */}
			<div class={styles.highlights}>
				<For each={highlights}>
					{(h) => (
						<div class={styles.highlightItem}>
							<span class={styles.highlightValue}>{h.value}</span>
							<span class={styles.highlightLabel}>{h.label}</span>
						</div>
					)}
				</For>
			</div>

			{/* ── \u529F\u80FD\u7F51\u683C ── */}
			<section class={styles.featuresSection}>
				<h2 class={styles.sectionTitle}>\u529F\u80FD\u6A21\u5757</h2>
				<p class={styles.sectionDesc}>
				\u6BCF\u4E2A\u6A21\u5757\u72EC\u7ACB\u53C8\u4E92\u8054\uFF0C\u56F4\u7ED5\u300C\u77E5\u8BC6\u300D\u8FD9\u4E00\u4E2A\u6838\u5FC3\u7EC4\u7EC7\u4F60\u7684\u6570\u5B57\u751F\u6D3B
				</p>
				<div class={styles.featureGrid}>
					<For each={modules}>
						{(m, i) => (
							<A
								href={m.path}
								class={styles.featureCard}
								style={{ "animation-delay": `${i() * 60}ms` }}
							>
								<div
									class={styles.featureIconWrap}
									style={{ background: `${m.color}14` }}
								>
									<ModuleIcon d={m.icon} color={m.color} />
								</div>
								<h3 class={styles.featureTitle}>{m.title}</h3>
								<p class={styles.featureDesc}>{m.desc}</p>
							</A>
						)}
					</For>
				</div>
			</section>

			{/* ── \u5E95\u90E8\u63D0\u793A ── */}
			<footer class={styles.footer}>
				<p class={styles.hint}>
				\u6309 <kbd>Ctrl+K</kbd> \u6253\u5F00\u547D\u4EE4\u9762\u677F \u00B7 <kbd>/</kbd> \u5BFC\u822A \u00B7{" "}
				<kbd>?</kbd> \u641C\u7D22 \u00B7 <kbd>:</kbd> \u6307\u4EE4
				</p>
			</footer>
		</div>
	);
}
