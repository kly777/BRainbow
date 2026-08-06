import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AUTH_REQUIRED_EVENT } from "@apis/request.ts";
import { useAuth } from "@auth/context.tsx";
import { NAV_ROUTES } from "../routes.ts";
import styles from "@components/CommandPalette.module.css";

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

interface Suggestion {
	label: string;
	desc: string;
	extra?: string;
	onSelect: () => void;
}

function SuggestionList(props: { items: Suggestion[] }) {
	return (
		<div class={styles.suggestions}>
			{props.items.map((s) => (
				<button
					type="button"
					class={styles.suggestionItem}
					onMouseDown={(e) => e.preventDefault()}
					onClick={s.onSelect}
				>
					<span class={styles.sugLabel}>{s.label}</span>
					<span class={styles.sugDesc}>{s.desc}</span>
					{s.extra && <span class={styles.sugPath}>{s.extra}</span>}
				</button>
			))}
		</div>
	);
}

function EmptyState(props: { text: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.empty}>{props.text}</div>
		</div>
	);
}

function SearchHint(props: { query: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.searchHint}>
				<kbd>Enter</kbd> 搜索 「{props.query}」
			</div>
		</div>
	);
}

export default function CommandPalette() {
	const navigate = useNavigate();
	const { auth, logout } = useAuth();
	const [value, setValue] = createSignal("");
	const [open, setOpen] = createSignal(false);

	let inputRef!: HTMLInputElement;
	let barRef!: HTMLDivElement;

	const mode = () => detectMode(value());
	const query = () => value().slice(1);

	const commands = createMemo(() => {
		const list = [
			{ label: ":home", desc: "回到首页", action: () => navigate("/") },
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

	const commit = () => {
		switch (mode()) {
			case "search":
				if (query()) searchWeb(query());
				break;
			case "nav":
				if (navItems().length > 0) navItems()[0].onSelect();
				break;
			case "cmd":
				if (cmdItems().length > 0) cmdItems()[0].onSelect();
				break;
		}
		close();
	};

	const openPalette = (prefix = "") => {
		setOpen(true);
		setValue(prefix);
		setTimeout(() => {
			inputRef?.focus();
			if (prefix) inputRef?.setSelectionRange(prefix.length, prefix.length);
		}, 0);
	};

	const close = () => {
		setOpen(false);
		setValue("");
	};

	const onInputKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
		if (e.key === "Enter") commit();
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
	onCleanup(() => globalThis.removeEventListener("keydown", globalKey));

	const ActionPanel = () => {
		const m = mode();
		const q = query();
		if (m === "nav") {
			if (navItems().length > 0) return <SuggestionList items={navItems()} />;
			if (q) return <EmptyState text="未匹配" />;
		}
		if (m === "cmd") {
			if (cmdItems().length > 0) return <SuggestionList items={cmdItems()} />;
			if (q) return <EmptyState text={auth().user ? "已登录" : "未登录"} />;
		}
		if (m === "search" && q) return <SearchHint query={q} />;
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
				<div ref={barRef} class={styles.bar}>
					<div class={styles.inputRow}>
						<span class={styles.prefix}>{MODE_PREFIX[mode()]}</span>
						<input
							ref={inputRef}
							class={styles.input}
							placeholder={MODE_PLACEHOLDER[mode()]}
							value={value()}
							onInput={(e) => setValue(e.currentTarget.value)}
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
