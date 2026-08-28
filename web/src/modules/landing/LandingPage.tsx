import { useAuth } from "@app/context/auth.tsx";
import { ArrowRight } from "@components/ui/icons";
import { MODULE_CARDS } from "@config/module-cards.ts";
import { A } from "@solidjs/router";
import { For } from "solid-js";
import styles from "./LandingPage.module.css";

// 落地页目录 = 有长文案的模块（图片等资源型入口不上目录）
const modules = MODULE_CARDS.filter((m) => m.title && m.detail);

// ── 事实条（真实能力，非虚构指标） ──
const facts = [
	{ value: "FSRS", label: "间隔重复算法" },
	{ value: "SSE", label: "流式 AI 对话" },
	{ value: "3 主题", label: "纸张 / 暗夜 / 晴空" },
	{ value: "⌘K", label: "全局命令面板" },
];

/** SVG 图标（Heroicons outline 风：stroke 1.5 / round cap-join） */
function ModuleIcon(props: { d: string; color?: string }) {
	return (
		<svg
			class={styles.tocIcon}
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
		<div class={styles.page}>
			{/* ── 书信开篇：字标 + 五色规线 + 大字 + 引文 + CTA ── */}
			<header class={styles.mast}>
				<div class={styles.brandRow}>
					<span class={styles.wordmark}>Brainbow</span>
					<span class={styles.brandRule} aria-hidden="true" />
				</div>
				<h1 class={styles.title}>用彩虹编织你的知识网络</h1>
				<p class={styles.lede}>
					任务、卡片、记忆、对话在一处生长，
					让碎片化的知识形成结构，让思考看得见。
				</p>
				<div class={styles.ctaRow}>
					<button
						type="button"
						class={styles.cta}
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
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M5 12h14M12 5l7 7-7 7" />
						</svg>
					</button>
					<span class={styles.ctaHint}>
						自托管 · <kbd>Ctrl</kbd>+<kbd>K</kbd> 呼出命令面板
					</span>
				</div>
			</header>

			{/* ── 事实条：上下细线夹住的 mono 数据带 ── */}
			<ul class={styles.facts}>
				<For each={facts}>
					{(f) => (
						<li class={styles.factItem}>
							<span class={styles.factValue}>{f.value}</span>
							<span class={styles.factLabel}>{f.label}</span>
						</li>
					)}
				</For>
			</ul>

			{/* ── 目录式模块清单：单列行列 + hairline 分隔 ── */}
			<section class={styles.toc}>
				<h2 class={styles.tocTitle}>功能模块</h2>
				<p class={styles.tocDesc}>
					每个模块独立又互联，围绕「知识」这一个核心组织你的数字生活
				</p>
				<ol class={styles.tocList}>
					<For each={modules}>
						{(m) => (
							<li>
								<A href={m.path} class={styles.tocRow}>
									<ModuleIcon d={m.icon} color={m.color} />
									<strong class={styles.tocName}>{m.title}</strong>
									<span class={styles.tocDescItem}>{m.detail}</span>
									<span class={styles.tocArrow} aria-hidden="true">
										<ArrowRight size={16} />
									</span>
								</A>
							</li>
						)}
					</For>
				</ol>
			</section>

			{/* ── 页脚快捷键提示 ── */}
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
