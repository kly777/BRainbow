import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { NAV_ROUTES } from "../routes.ts";
import { AUTH_REQUIRED_EVENT } from "../apis/request.ts";
import { useAuth } from "../auth/context.tsx";
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

/** 全局按键 → 模式映射 */
const KEY_TO_PREFIX: Record<string, string> = {
    "/": "/",
    "?": "?",
    "：": "?", // 全角
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

    // ── 派生状态 ──

    const mode = () => detectMode(value());
    const query = () => value().slice(1);

    // ── 命令 ──

    const commands = createMemo(() => {
        if (!auth().user) {
            return [
                {
                    label: ":login",
                    desc: "登录",
                    action: () =>
                        globalThis.dispatchEvent(
                            new CustomEvent(AUTH_REQUIRED_EVENT),
                        ),
                },
            ];
        }
        return [
            {
                label: ":logout",
                desc: "退出登录",
                action: () => logout(),
            },
        ];
    });

    // ── 匹配 ──

    const navItems = createMemo<Suggestion[]>(() => {
        if (mode() !== "nav") return [];
        const q = query();
        return NAV_ROUTES.filter(
            (r) =>
                r.label.includes(q) ||
                r.desc.includes(q) ||
                r.path.slice(1).includes(q),
        ).map((r) => ({
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
        return commands()
            .filter((c) => c.label.slice(1).includes(q) || c.desc.includes(q))
            .map((c) => ({
                label: c.label,
                desc: c.desc,
                onSelect: () => {
                    c.action();
                    close();
                },
            }));
    });

    // ── 提交 ──

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

    // ── 面板开关 ──

    const openPalette = (prefix = "") => {
        setOpen(true);
        setValue(prefix);
        setTimeout(() => {
            inputRef?.focus();
            if (prefix)
                inputRef?.setSelectionRange(prefix.length, prefix.length);
        }, 0);
    };

    const close = () => {
        setOpen(false);
        setValue("");
    };

    const onBarBlur = (e: FocusEvent) => {
        if (!barRef.contains(e.relatedTarget as Node)) close();
    };

    const onInputKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") commit();
    };

    // ── 全局快捷键 ──

    const globalKey = (e: KeyboardEvent) => {
        // Ctrl+K
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
            e.preventDefault();
            openPalette();
            return;
        }

        // 不在输入框内时，触发字符直接打开对应模式
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

    // ── 建议面板 ──

    const ActionPanel = () => {
        const m = mode();
        const q = query();

        if (m === "nav") {
            if (navItems().length > 0)
                return <SuggestionList items={navItems()} />;
            if (q) return <EmptyState text="未匹配" />;
        }

        if (m === "cmd") {
            if (cmdItems().length > 0)
                return <SuggestionList items={cmdItems()} />;
            if (q)
                return <EmptyState text={auth().user ? "已登录" : "未登录"} />;
        }

        if (m === "search" && q) return <SearchHint query={q} />;

        return null;
    };

    // ── 渲染 ──

    return (
        <div
            ref={barRef}
            class={styles.bar}
            classList={{ [styles.barOpen]: open() }}
            onFocusOut={onBarBlur}
        >
            {open() ? (
                <div class={styles.inputWrap}>
                    {ActionPanel()}
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
                </div>
            ) : (
                <button
                    type="button"
                    class={styles.trigger}
                    onClick={() => openPalette()}
                    title="命令面板 (Ctrl+K)"
                >
                    <span class={styles.triggerHint}>
                        / 导航 &nbsp; ? 搜索 &nbsp; : 指令
                    </span>
                    <kbd class={styles.kbd}>Ctrl+K</kbd>
                </button>
            )}
        </div>
    );
}
