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
		title: "任务管理",
		desc: "列表、看板、日历、DAG 四种视图，灵活管理待办事项",
		color: "var(--t-color-accent)",
	},
	{
		path: PATHS.card,
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
		title: "知识卡片",
		desc: "记录知识片段，构建你的个人知识库",
		color: "oklch(55% 0.13 160deg)",
	},
	{
		path: PATHS.memory,
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
		title: "间隔记忆",
		desc: "基于 FSRS 算法的智能间隔复习系统",
		color: "oklch(60% 0.12 85deg)",
	},
	{
		path: PATHS.ontology,
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
		title: "本体系统",
		desc: "管理概念本体与符号关系，结构化思维",
		color: "oklch(50% 0.14 255deg)",
	},
	{
		path: PATHS.conversation,
		icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
		title: "知识搜索",
		desc: "搜索 AI 对话历史，快速定位知识",
		color: "oklch(55% 0.16 25deg)",
	},
	{
		path: PATHS.chat,
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
		title: "AI 对话",
		desc: "多轮对话、树状分支、修订上下文",
		color: "oklch(55% 0.12 300deg)",
	},
	{
		path: PATHS.text,
		icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
		title: "文本编辑",
		desc: "多标签纯文本编辑器，高效书写",
		color: "oklch(45% 0.1 200deg)",
	},
	{
		path: PATHS.bookmark,
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
		title: "书签管理",
		desc: "收藏和整理网页书签",
		color: "oklch(55% 0.1 80deg)",
	},
];

// ── 亮点数据 ──
const highlights = [
	{ value: "FSRS", label: "间隔重复算法" },
	{ value: "SSE", label: "流式 AI 对话" },
	{ value: "3 主题", label: "纸张 / 暗夜 / 晴空" },
	{ value: "⌘K", label: "全局命令面板" },
];

/** SVG 图标组件（Heroicons outline 风格） */
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
			{/* ── Hero 区 ── */}
			<header class={styles.hero}>
				<div class={styles.heroBadge}>个人知识工作台</div>
				<h1 class={styles.heroTitle}>
					用<span class={styles.gradientText}>彩虹</span>
					编织你的知识网络
				</h1>
				<p class={styles.heroSubtitle}>
					任务、卡片、记忆、对话在一处生长，
					让碎片化的知识形成结构，让思考看得见。
				</p>
				<div class={styles.ctaRow}>
					<button
						type="button"
						class={styles.ctaPrimary}
						onClick={() =>
							globalThis.dispatchEvent(new CustomEvent("auth:required"))
						}
					>
						开始使用
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
				</div>
			</header>

			{/* ── 亮点条 ── */}
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

			{/* ── 功能网格 ── */}
			<section class={styles.featuresSection}>
				<h2 class={styles.sectionTitle}>功能模块</h2>
				<p class={styles.sectionDesc}>
					每个模块独立又互联，围绕「知识」这一个核心组织你的数字生活
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
									style={{ "--module-color": m.color }}
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

			{/* ── 底部提示 ── */}
			<footer class={styles.footer}>
				<p class={styles.hint}>
					<span>
						<kbd>Ctrl+K</kbd> 命令面板
					</span>
					<span>
						<kbd>/</kbd> 导航
					</span>
					<span>
						<kbd>?</kbd> 搜索
					</span>
					<span>
						<kbd>:</kbd> 指令
					</span>
				</p>
			</footer>
		</div>
	);
}
