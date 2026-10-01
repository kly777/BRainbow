// ── 命令面板的状态与事件逻辑 ──
// 组合入口：模式检测 + 命令列表 + 站内搜索（usePaletteSearch）。

import { useAuth } from "@app/context/auth.tsx";
import { PATHS } from "@config/paths";
import { openAiSettings } from "@modules/ai-setting";
import { AUTH_REQUIRED_EVENT } from "@shared/api";
import { isImeComposing, isTypingTarget } from "@shared/utils";
import { addRecentPage } from "@shared/utils/recent-pages.ts";
import { useNavigate } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import {
	buildCmdItems,
	buildIdleItems,
	buildNavItems,
	probeDuck,
} from "./suggestions.ts";
import { usePaletteSearch } from "./usePaletteSearch.ts";

export type Mode = "idle" | "nav" | "search" | "cmd";

const EMPTY_SUGGESTIONS: Suggestion[] = [];

export const MODE_PREFIX: Record<Mode, string> = {
	idle: "",
	nav: "/",
	search: "?",
	cmd: ":",
};
export const MODE_PLACEHOLDER: Record<Mode, string> = {
	// idle 现在"直接打字"就有用（本地跳页面 + 可转站内搜索），前缀是进阶开关
	idle: "搜索、跳转或执行命令（/ ? : 换模式）",
	nav: "输入路由名称…",
	search: "输入搜索关键词…",
	cmd: "输入指令…",
};

/**
 * 可选项在 DOM 里的 id：输入框的 `aria-activedescendant` 指向它，
 * 读屏才知道当前高亮的是哪一条（DOM 焦点始终留在输入框里）。
 * 列表渲染与这里必须用同一个拼法 —— 所以只此一处。
 */
export const optionDomId = (index: number) => `palette-option-${index}`;

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

export interface Suggestion {
	label: string;
	desc: string;
	/** 带关键词高亮的描述（HTML），用于搜索结果展示 */
	highlightedDesc?: string;
	extra?: string;
	/** 是否为分组标题（不可选中） */
	isHeader?: boolean;
	onSelect: () => void;
}

export function usePalette() {
	const routerNavigate = useNavigate();
	const { auth, logout } = useAuth();

	/** 包装 navigate，自动记录最近访问页面 */
	const navigate = (path: string) => {
		addRecentPage(path);
		routerNavigate(path);
	};
	const [value, setValue] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	/** 输入法组字中：搜索要等 compositionend，别按拼音中间态去搜 */
	const [composing, setComposing] = createSignal(false);

	let inputRef!: HTMLInputElement;
	let sugScrollRef: HTMLDivElement | undefined;
	/** 打开面板前焦点在哪：关闭时还回去，键盘用户不会"丢在原地" */
	let lastFocused: HTMLElement | null = null;

	const mode = createMemo(() => detectMode(value()));
	// 前缀只有 nav / search / cmd 三个模式才有；idle 下整串都是查询词。
	// （曾经无条件 slice(1)：idle 打字会被吃掉第一个字，"文件"变成"件"）
	const query = () => (mode() === "idle" ? value() : value().slice(1));

	const close = () => {
		setOpen(false);
		setValue("");
		// 面板卸载会把焦点丢到 body —— 还回打开前的元素。
		// 用微任务：等 Solid 把 <Show> 的 DOM 移除批处理完再聚焦，否则会被移除动作打断。
		// 元素可能已经不在了（跳转到了别的页面），先查 isConnected
		const target = lastFocused;
		lastFocused = null;
		queueMicrotask(() => {
			if (target?.isConnected) target.focus();
		});
	};

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

	const navItems = createMemo<Suggestion[]>(() =>
		mode() === "nav"
			? buildNavItems(query(), navigate, close)
			: EMPTY_SUGGESTIONS,
	);

	// idle：不打前缀也有用 —— 本地跳页面，输入还能一键转站内搜索（选中后停在 `?` 模式）
	const idleItems = createMemo<Suggestion[]>(() =>
		mode() === "idle"
			? buildIdleItems(query(), navigate, close, (q) => setValue(`?${q}`))
			: EMPTY_SUGGESTIONS,
	);

	const cmdItems = createMemo<Suggestion[]>(() =>
		mode() === "cmd" ? buildCmdItems(query(), commands()) : EMPTY_SUGGESTIONS,
	);

	// ── 子 hook：站内搜索 ──
	const search = usePaletteSearch({
		mode,
		query,
		composing,
		setQuery: setValue,
		navigate,
		close,
	});

	/** 当前模式下的建议列表 */
	const currentItems = createMemo<Suggestion[]>(() =>
		mode() === "nav"
			? navItems()
			: mode() === "cmd"
				? cmdItems()
				: mode() === "search"
					? search.searchItems()
					: idleItems(),
	);

	// 选中项变化时滚动到可见
	createEffect(() => {
		const index = selectedIndex();
		const el = sugScrollRef?.children[index] as HTMLElement | undefined;
		if (!el) return;
		requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
	});

	const commit = () => {
		const items = currentItems();
		if (items.length > 0) {
			items[Math.min(selectedIndex(), items.length - 1)].onSelect();
		} else if (mode() === "search" && query()) {
			navigate(`${PATHS.search}?q=${encodeURIComponent(query())}`);
		}
		close();
	};

	const openPalette = (prefix = "") => {
		lastFocused = document.activeElement as HTMLElement | null;
		setOpen(true);
		setValue(prefix);
		setSelectedIndex(0);
	};

	/**
	 * 选中项必须落在**可选项**上：分组标题不可选，落在标题上时回车会静默关掉面板
	 * （多分组搜索结果的第一项正是标题，而输入后我们会把选中重置为 0）。
	 * 列表一变就重新定位 —— 打字筛小、结果刷新都走这里。
	 */
	createEffect(() => {
		const items = currentItems();
		if (items.length === 0) return;
		const current = items[selectedIndex()];
		if (current && !current.isHeader) return;
		const first = items.findIndex((item) => !item.isHeader);
		if (first >= 0) setSelectedIndex(first);
	});

	/** 当前高亮项在 DOM 里的 id：给 combobox 的 `aria-activedescendant` 用（标题不是选项） */
	const activeOptionId = () => {
		const item = currentItems()[selectedIndex()];
		return item && !item.isHeader ? optionDomId(selectedIndex()) : undefined;
	};

	// 打开时立即聚焦
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

	const onInputKey = (e: KeyboardEvent) => {
		// 输入法组字中：回车是选候选词、上下键是翻候选、Esc 是撤候选 —— 都不归我们管。
		// 不放行的话，中文用户一按回车选词就把面板里"随便哪一项"执行掉并关掉面板
		if (isImeComposing(e)) return;
		if (e.key === "Escape") {
			close();
			return;
		}
		if (e.key === "Tab") {
			// 面板声明了 aria-modal：Tab 不许把焦点带到面板背后的页面上。
			// 本面板全靠方向键导航（每行都是按钮，但由 ↑↓ 驱动），焦点留在输入框即可
			e.preventDefault();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
			return;
		}
		const items = currentItems();
		const len = items.length;
		if (len === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => {
				let next = (i + 1) % len;
				// 跳过分组标题
				while (items[next]?.isHeader && next !== i) {
					next = (next + 1) % len;
				}
				return next;
			});
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => {
				let next = (i - 1 + len) % len;
				// 跳过分组标题
				while (items[next]?.isHeader && next !== i) {
					next = (next - 1 + len) % len;
				}
				return next;
			});
		}
	};

	const globalKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "k") {
			e.preventDefault();
			if (open()) close();
			else openPalette();
			return;
		}
		if (
			isTypingTarget(e.target, { includeSelect: true }) ||
			e.altKey ||
			e.ctrlKey ||
			e.metaKey
		)
			return;
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
	});

	return {
		value,
		setValue,
		open,
		selectedIndex,
		setSelectedIndex,
		searching: search.searching,
		mode,
		query,
		currentItems,
		navItems,
		cmdItems,
		searchItems: search.searchItems,
		auth,
		onInputKey,
		openPalette,
		close,
		activeOptionId,
		/** 组字状态由输入框的 composition 事件驱动（见 usePaletteSearch 的搜索闸门） */
		onCompositionStart: () => setComposing(true),
		onCompositionEnd: () => setComposing(false),
		bindInput: (el: HTMLInputElement) => {
			inputRef = el;
		},
		bindSugScroll: (el: HTMLDivElement) => {
			sugScrollRef = el;
		},
	};
}
