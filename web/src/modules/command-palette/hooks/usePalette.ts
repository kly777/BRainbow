// ── 命令面板的状态与事件逻辑 ──
// 组合入口：模式检测 + 命令列表 + 站内搜索（usePaletteSearch）。

import { useAuth } from "@app/context/auth.tsx";
import { PATHS } from "@config/paths";
import { openAiSettings } from "@modules/ai-setting";
import { AUTH_REQUIRED_EVENT } from "@shared/api";
import { addRecentPage } from "@shared/utils/recent-pages.ts";
import { useNavigate } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { buildCmdItems, buildNavItems, probeDuck } from "./suggestions.ts";
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

	let inputRef!: HTMLInputElement;
	let sugScrollRef: HTMLDivElement | undefined;

	const mode = createMemo(() => detectMode(value()));
	const query = () => value().slice(1);

	const close = () => {
		setOpen(false);
		setValue("");
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

	const cmdItems = createMemo<Suggestion[]>(() =>
		mode() === "cmd" ? buildCmdItems(query(), commands()) : EMPTY_SUGGESTIONS,
	);

	// ── 子 hook：站内搜索 ──
	const search = usePaletteSearch({
		mode,
		query,
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
					: EMPTY_SUGGESTIONS,
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
		setOpen(true);
		setValue(prefix);
		setSelectedIndex(0);
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
		if (e.key === "Escape") {
			close();
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
		bindInput: (el: HTMLInputElement) => {
			inputRef = el;
		},
		bindSugScroll: (el: HTMLDivElement) => {
			sugScrollRef = el;
		},
	};
}
