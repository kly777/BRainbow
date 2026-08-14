// ── 命令面板的状态与事件逻辑（建议构建见 suggestions.ts） ──

import { PATHS } from "@config/paths";
import { AUTH_REQUIRED_EVENT } from "@lib/api";
import { openAiSettings } from "@modules/ai-setting";
import { useAuth } from "@modules/auth";
import { useNavigate } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { type SearchHit, searchE } from "../api.ts";
import {
	buildCmdItems,
	buildNavItems,
	buildSearchItems,
	probeDuck,
	searchWeb,
} from "./suggestions.ts";

export type Mode = "idle" | "nav" | "search" | "cmd";

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
	extra?: string;
	onSelect: () => void;
}

export function usePalette() {
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
		mode() === "nav" ? buildNavItems(query(), navigate, close) : [],
	);

	const cmdItems = createMemo<Suggestion[]>(() =>
		mode() === "cmd" ? buildCmdItems(query(), commands()) : [],
	);

	const searchItems = createMemo<Suggestion[]>(() =>
		mode() === "search"
			? buildSearchItems(hits(), query().trim(), searching(), navigate, close)
			: [],
	);

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

	// ── 站内搜索：防抖请求 + 结果映射 ──
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

	return {
		value,
		setValue,
		open,
		selectedIndex,
		setSelectedIndex,
		searching,
		mode,
		query,
		currentItems,
		navItems,
		cmdItems,
		searchItems,
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
