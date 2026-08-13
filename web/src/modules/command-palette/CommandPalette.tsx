import { NAV_ROUTES, PATHS } from "@app/config";
import { AUTH_REQUIRED_EVENT } from "@lib/api";
import { openAiSettings } from "@modules/ai-setting";
import { useAuth } from "@modules/auth";
import { useNavigate } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { type SearchHit, searchE } from "./api.ts";
import styles from "./CommandPalette.module.css";

const BING = "https://www.bing.com/search?q=";
const DUCK = "https://duckduckgo.com/?q=";
let _engine = BING;

function probeDuck() {
	const img = new Image();
	img.onload = () => {
		_engine = DUCK;
	};
	img.src = "https://duckduckgo.com/favicon.ico";
}

function searchWeb(query: string) {
	globalThis.open(`${_engine}${encodeURIComponent(query.trim())}`, "_blank");
}

type Mode = "idle" | "nav" | "search" | "cmd";

const MODE_PREFIX: Record<Mode, string> = {
	idle: "",
	nav: "/",
	search: "?",
	cmd: ":",
};
const MODE_PLACEHOLDER: Record<Mode, string> = {
	idle: "输入 / 导航  ? 搜索  : 指令",
	nav: "输入路由名称…",
	search: "输入搜索关键词…",
	cmd: "输入指令…",
};

function detectMode(value: string): Mode {
	if (value.startsWith("/")) return "nav";
	if (value.startsWith("?")) return "search";
	if (value.startsWith(":")) return "cmd";
	return "idle";
}

const KEY_TO_PREFIX: Record<string, string> = {
	"/": "/",
	"?": "?",
	"：": "?",
	":": ":",
};

/** 站内搜索结果的模块中文标签 */
const KIND_LABEL: Record<string, string> = {
	mem: "记忆",
	card: "卡片",
	task: "任务",
	bookmark: "书签",
	onto: "本体",
	text: "文本",
	reading: "阅读",
	conv: "对话",
	chat: "AI 对话",
};

interface Suggestion {
	label: string;
	desc: string;
	extra?: string;
	onSelect: () => void;
}

function SuggestionList(props: {
	items: Suggestion[];
	selected: number;
	onHover: (i: number) => void;
	listRef: (el: HTMLDivElement) => void;
}) {
	return (
		<div class={styles.suggestions}>
			<div ref={props.listRef} class={styles.sugScroll}>
				<For each={props.items}>
					{(s, i) => (
						<button
							type="button"
							class={styles.suggestionItem}
							classList={{
								[styles.suggestionActive]: i() === props.selected,
							}}
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => props.onHover(i())}
							onClick={s.onSelect}
						>
							<span class={styles.sugLabel}>{s.label}</span>
							<span class={styles.sugDesc}>{s.desc}</span>
							{s.extra && <span class={styles.sugPath}>{s.extra}</span>}
						</button>
					)}
				</For>
			</div>
			<div class={styles.sugFooter}>
				<span>↑↓ 选择</span>
				<span>Enter 打开</span>
				<span>Esc 关闭</span>
			</div>
		</div>
	);
}

function EmptyState(props: { text: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<div class={styles.empty}>{props.text}</div>
			</div>
		</div>
	);
}

function SearchHint(props: { query: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<div class={styles.searchHint}>
					<kbd>Enter</kbd> 搜索 「{props.query}」
				</div>
			</div>
		</div>
	);
}

export default function CommandPalette() {
	const navigate = useNavigate();
	const { auth, logout } = useAuth();
	const [value, setValue] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	// ── 站内搜索状态 ──
	const [hits, setHits] = createSignal<SearchHit[]>([]);
	const [searching, setSearching] = createSignal(false);

	let inputRef!: HTMLInputElement;
	let sugScrollRef: HTMLDivElement | undefined;

	const mode = () => detectMode(value());
	const query = () => value().slice(1);

	/** 当前模式下的建议列表（nav/cmd/search），其余模式为空 */
	const currentItems = () =>
		mode() === "nav"
			? navItems()
			: mode() === "cmd"
				? cmdItems()
				: mode() === "search"
					? searchItems()
					: [];

	// 选中项变化时才滚动到可见（不滚动容器本身）。
	// 放在顶层而不是 SuggestionList 内：避免每次输入重建列表时
	// 注册新 effect 触发 scrollIntoView（同步强制布局，造成卡顿）
	createEffect(() => {
		// 先读 signal 建立订阅：不能写 sugScrollRef?.children[selectedIndex()]，
		// 可选链在 sugScrollRef 为空时短路，selectedIndex 不会被追踪，
		// 之后列表出现后按 ↑↓ 也不会再触发滚动
		const index = selectedIndex();
		const el = sugScrollRef?.children[index] as HTMLElement | undefined;
		if (!el) return;
		// rAF 延后到帧末：输入期间多次选中变化只滚一次，避免同步布局抖动
		requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
	});

	const commands = createMemo(() => {
		const list = [
			{ label: ":home", desc: "回到首页", action: () => navigate(PATHS.home) },
			{
				label: ":top",
				desc: "滚动到页面顶部",
				action: () => globalThis.scrollTo({ top: 0, behavior: "smooth" }),
			},
			{
				label: ":reload",
				desc: "重新加载页面",
				action: () => globalThis.location.reload(),
			},
			{
				label: ":ai",
				desc: "打开 AI 设置",
				action: () => {
					close();
					openAiSettings();
				},
			},
		];
		if (!auth().user) {
			list.push({
				label: ":loginE",
				desc: "登录",
				action: () =>
					globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT)),
			});
		} else {
			list.push({ label: ":logout", desc: "退出登录", action: () => logout() });
		}
		return list;
	});

	const navItems = createMemo<Suggestion[]>(() => {
		if (mode() !== "nav") return [];
		const q = query();
		// 匹配质量排序：路径精确 > 路径前缀 > label 匹配 > desc 匹配 > 路径包含。
		// 输入 `/m` 时「记忆」(path=/m) 必须排在「书签」(path=/bookmark 含 m) 前面
		const score = (r: (typeof NAV_ROUTES)[number]): number => {
			const p = r.path.slice(1);
			if (p === q) return 0;
			if (p.startsWith(q)) return 1;
			if (r.label.includes(q)) return 2;
			if (r.desc.includes(q)) return 3;
			return 4; // 仅路径包含
		};
		return NAV_ROUTES.filter(
			(r) =>
				r.label.includes(q) ||
				r.desc.includes(q) ||
				r.path.slice(1).includes(q),
		)
			.sort((a, b) => score(a) - score(b))
			.map((r) => ({
				label: r.label,
				desc: r.desc,
				extra: r.path,
				onSelect: () => {
					navigate(r.path);
					close();
				},
			}));
	});

	const cmdItems = createMemo<Suggestion[]>(() => {
		if (mode() !== "cmd") return [];
		const q = query();
		// 命令名（不含 : 前缀）前缀匹配优先于包含匹配
		const score = (c: ReturnType<typeof commands>[number]): number => {
			const name = c.label.slice(1);
			if (name.startsWith(q)) return 0;
			if (c.label.includes(q)) return 1;
			return 2; // 仅 desc 匹配
		};
		return commands()
			.filter((c) => c.label.slice(1).includes(q) || c.desc.includes(q))
			.sort((a, b) => score(a) - score(b))
			.map((c) => ({
				label: c.label,
				desc: c.desc,
				onSelect: () => {
					c.action();
					close();
				},
			}));
	});

	// ── 站内搜索：防抖请求 + 结果映射（末尾附加"网页搜索"兜底项） ──
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchSeq = 0;
	createEffect(() => {
		if (mode() !== "search") return;
		const q = query().trim();
		clearTimeout(searchTimer);
		if (!q) {
			setHits([]);
			setSearching(false);
			return;
		}
		// 输入变化立即清空旧结果：列表只反映当前关键词，不显示上一条查询的残留
		const seq = ++searchSeq;
		setHits([]);
		setSearching(true);
		searchTimer = setTimeout(async () => {
			try {
				const res = await searchE(q);
				// 竞态保护：仅最新一次输入的结果生效
				if (seq === searchSeq) setHits(res.hits.slice(0, 24));
			} catch {
				if (seq === searchSeq) setHits([]);
			} finally {
				if (seq === searchSeq) setSearching(false);
			}
		}, 300);
	});

	const searchItems = createMemo<Suggestion[]>(() => {
		if (mode() !== "search") return [];
		const q = query().trim();
		const items: Suggestion[] = hits().map((h) => ({
			label: h.title,
			desc: h.snippet,
			extra: KIND_LABEL[h.kind] ?? h.kind,
			onSelect: () => {
				navigate(h.url);
				close();
			},
		}));
		if (q && !searching()) {
			items.push({
				label: `在浏览器中搜索「${q}」`,
				desc: "站内未命中时使用外部搜索引擎",
				extra: "web",
				onSelect: () => {
					searchWeb(q);
					close();
				},
			});
		}
		return items;
	});

	const commit = () => {
		if (mode() === "search") {
			const items = currentItems();
			if (items.length > 0) {
				items[Math.min(selectedIndex(), items.length - 1)].onSelect();
			} else if (query()) {
				searchWeb(query());
			}
		} else {
			const items = currentItems();
			if (items.length > 0) {
				items[Math.min(selectedIndex(), items.length - 1)].onSelect();
			}
		}
		close();
	};

	const openPalette = (prefix = "") => {
		setOpen(true);
		setValue(prefix);
		setSelectedIndex(0);
	};

	// 打开时立即聚焦（同一帧内完成，避免 setTimeout 延迟导致
	// 输入框边框高亮晚于建议列表出现——即"边框不同步"的来源）
	let wasOpen = false;
	createEffect(() => {
		const isOpen = open();
		if (isOpen && !wasOpen) {
			inputRef?.focus();
			const p = value();
			if (p) inputRef?.setSelectionRange(p.length, p.length);
		}
		wasOpen = isOpen;
	});

	const close = () => {
		setOpen(false);
		setValue("");
	};

	const onInputKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			close();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
			return;
		}
		const len = currentItems().length;
		if (len === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => (i + 1) % len);
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => (i - 1 + len) % len);
		}
	};

	const globalKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "k") {
			e.preventDefault();
			if (open()) close();
			else openPalette();
			return;
		}
		const tag = (e.target as HTMLElement)?.tagName;
		const inInput =
			tag === "INPUT" ||
			tag === "TEXTAREA" ||
			tag === "SELECT" ||
			(e.target as HTMLElement)?.isContentEditable;
		if (inInput || e.altKey || e.ctrlKey || e.metaKey) return;
		const prefix = KEY_TO_PREFIX[e.key];
		if (prefix) {
			e.preventDefault();
			openPalette(prefix);
		}
	};

	onMount(() => {
		globalThis.addEventListener("keydown", globalKey);
		probeDuck();
	});
	onCleanup(() => {
		globalThis.removeEventListener("keydown", globalKey);
		clearTimeout(searchTimer);
	});

	const ActionPanel = () => {
		const m = mode();
		const q = query();
		if (m === "nav") {
			if (navItems().length > 0)
				return (
					<SuggestionList
						items={navItems()}
						selected={selectedIndex()}
						onHover={setSelectedIndex}
						listRef={(el) => {
							sugScrollRef = el;
						}}
					/>
				);
			if (q) return <EmptyState text="未匹配" />;
		}
		if (m === "cmd") {
			if (cmdItems().length > 0)
				return (
					<SuggestionList
						items={cmdItems()}
						selected={selectedIndex()}
						onHover={setSelectedIndex}
						listRef={(el) => {
							sugScrollRef = el;
						}}
					/>
				);
			if (q) return <EmptyState text={auth().user ? "已登录" : "未登录"} />;
		}
		if (m === "search") {
			if (searchItems().length > 0)
				return (
					<SuggestionList
						items={searchItems()}
						selected={selectedIndex()}
						onHover={setSelectedIndex}
						listRef={(el) => {
							sugScrollRef = el;
						}}
					/>
				);
			if (searching() && q) return <EmptyState text="搜索中…" />;
			if (q) return <SearchHint query={q} />;
		}
		return null;
	};

	return (
		<>
			{/* 遮罩 + 面板 */}
			<Show when={open()}>
				<button
					type="button"
					class={styles.overlay}
					onClick={close}
					aria-label="关闭"
				/>
				<div class={styles.bar}>
					<div class={styles.inputRow}>
						<span class={styles.prefix}>{MODE_PREFIX[mode()]}</span>
						<input
							ref={inputRef}
							class={styles.input}
							placeholder={MODE_PLACEHOLDER[mode()]}
							value={value()}
							onInput={(e) => {
								setValue(e.currentTarget.value);
								// 输入变化后列表重建，选中回到第一项
								setSelectedIndex(0);
							}}
							onKeyDown={onInputKey}
						/>
					</div>
					{ActionPanel()}
				</div>
			</Show>

			{/* 移动端 FAB（桌面隐藏） */}
			<button
				type="button"
				class={styles.fab}
				onClick={() => openPalette()}
				title="命令面板"
			>
				⌘
			</button>
		</>
	);
}
