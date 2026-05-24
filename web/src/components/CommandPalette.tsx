import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { NAV_ROUTES } from "../routes.ts";
import {
    AUTH_REQUIRED_EVENT,
} from "../apis/request.ts";
import { useAuth } from "../auth/context.tsx";
import styles from "./CommandPalette.module.css";

const DUCK = "https://duckduckgo.com/?q=";
const BING = "https://www.bing.com/search?q=";

let _cachedEngine = BING;

function getEngine(): string {
    return _cachedEngine;
}

function probeDuck() {
    const img = new Image();
    img.onload = () => {
        _cachedEngine = DUCK;
    };
    img.src = "https://duckduckgo.com/favicon.ico";
}

function search(query: string) {
    globalThis.open(
        `${getEngine()}${encodeURIComponent(query.trim())}`,
        "_blank",
    );
}

interface Command {
    label: string;
    desc: string;
    action: () => void;
}

export default function CommandPalette() {
    const navigate = useNavigate();
    const { auth, logout } = useAuth();
    const [value, setValue] = createSignal("");
    const [open, setOpen] = createSignal(false);

    let inputRef!: HTMLInputElement;
    let barRef!: HTMLDivElement;

    const isNav = () => value().startsWith("/");
    const isSearch = () => value().startsWith("?");
    const isCmd = () => value().startsWith(":");
    const queryText = () => value().slice(1);

    // ── 命令列表 ──
    const commands = createMemo<Command[]>(() => {
        const list: Command[] = [];
        if (!auth().user) {
            list.push({
                label: ":login",
                desc: "登录",
                action: () =>
                    globalThis.dispatchEvent(
                        new CustomEvent(AUTH_REQUIRED_EVENT),
                    ),
            });
        } else {
            list.push({
                label: ":logout",
                desc: "退出登录",
                action: () => logout(),
            });
        }
        return list;
    });

    const navMatches = () =>
        isNav()
            ? NAV_ROUTES.filter(
                (r) =>
                    r.label.includes(queryText()) ||
                    r.desc.includes(queryText()) ||
                    r.path.slice(1).includes(queryText()),
            )
            : [];

    const cmdMatches = () =>
        isCmd()
            ? commands().filter(
                (c) =>
                    c.label.slice(1).includes(queryText()) ||
                    c.desc.includes(queryText()),
            )
            : [];

    const commit = () => {
        if (isSearch() && queryText()) {
            search(queryText());
        } else if (isNav() && navMatches().length > 0) {
            navigate(navMatches()[0].path);
        } else if (isCmd() && cmdMatches().length > 0) {
            cmdMatches()[0].action();
        }
        close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") commit();
    };

    const openPalette = (initial = "") => {
        setOpen(true);
        setValue(initial);
        setTimeout(() => {
            inputRef?.focus();
            if (initial) {
                inputRef?.setSelectionRange(initial.length, initial.length);
            }
        }, 0);
    };

    const close = () => {
        setOpen(false);
        setValue("");
    };

    const onBarBlur = (e: FocusEvent) => {
        if (!barRef.contains(e.relatedTarget as Node)) close();
    };

    // 全局快捷键
    const globalKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
            e.preventDefault();
            openPalette();
            return;
        }

        const tag = (e.target as HTMLElement)?.tagName;
        const isInput =
            tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
            (e.target as HTMLElement)?.isContentEditable;
        if (isInput || e.altKey || e.ctrlKey || e.metaKey) return;

        if (e.key === "/") {
            e.preventDefault();
            openPalette("/");
        } else if (e.key === "?" || e.key === "？") {
            e.preventDefault();
            openPalette("?");
        } else if (e.key === ":") {
            e.preventDefault();
            openPalette(":");
        }
    };

    onMount(() => {
        globalThis.addEventListener("keydown", globalKey);
        probeDuck();
    });
    onCleanup(() => globalThis.removeEventListener("keydown", globalKey));

    const prefix = () =>
        isNav() ? "/" : isSearch() ? "?" : isCmd() ? ":" : "";

    const placeholder = () => {
        if (isNav()) return "输入路由名称…";
        if (isSearch()) return "输入搜索关键词…";
        if (isCmd()) return "输入指令…";
        return "输入 / 导航  ? 搜索  : 指令";
    };

    return (
        <div
            ref={barRef}
            class={styles.bar}
            classList={{ [styles.barOpen]: open() }}
            onFocusOut={onBarBlur}
        >
            {!open() ? (
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
            ) : (
                <div class={styles.inputWrap}>
                    {/* 导航建议 */}
                    {isNav() && navMatches().length > 0 && (
                        <div class={styles.suggestions}>
                            {navMatches().map((m) => (
                                <button
                                    type="button"
                                    class={styles.suggestionItem}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        navigate(m.path);
                                        close();
                                    }}
                                >
                                    <span class={styles.sugLabel}>
                                        {m.label}
                                    </span>
                                    <span class={styles.sugDesc}>
                                        {m.desc}
                                    </span>
                                    <span class={styles.sugPath}>
                                        {m.path}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {isNav() && queryText() && navMatches().length === 0 && (
                        <div class={styles.suggestions}>
                            <div class={styles.empty}>未匹配</div>
                        </div>
                    )}

                    {/* 搜索提示 */}
                    {isSearch() && queryText() && (
                        <div class={styles.suggestions}>
                            <div class={styles.searchHint}>
                                <kbd>Enter</kbd> 搜索 「{queryText()}」
                            </div>
                        </div>
                    )}

                    {/* 指令建议 */}
                    {isCmd() && cmdMatches().length > 0 && (
                        <div class={styles.suggestions}>
                            {cmdMatches().map((c) => (
                                <button
                                    type="button"
                                    class={styles.suggestionItem}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        c.action();
                                        close();
                                    }}
                                >
                                    <span class={styles.sugLabel}>
                                        {c.label}
                                    </span>
                                    <span class={styles.sugDesc}>
                                        {c.desc}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {isCmd() && queryText() && cmdMatches().length === 0 && (
                        <div class={styles.suggestions}>
                            <div class={styles.empty}>
                                {auth().user ? "已登录" : "未登录"}
                            </div>
                        </div>
                    )}

                    <div class={styles.inputRow}>
                        <span class={styles.prefix}>{prefix()}</span>
                        <input
                            ref={inputRef}
                            class={styles.input}
                            placeholder={placeholder()}
                            value={value()}
                            onInput={(e) =>
                                setValue(e.currentTarget.value)}
                            onKeyDown={onKeyDown}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
