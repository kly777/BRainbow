import { createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { NAV_ROUTES } from "../routes.ts";
import styles from "./CommandPalette.module.css";

const DUCK = "https://duckduckgo.com/?q=";
const BING = "https://www.bing.com/search?q=";

let _cachedEngine = BING;

function getEngine(): string {
  return _cachedEngine;
}

/** 后台探测 DDG 可达性，成功则切换 */
function probeDuck() {
  const img = new Image();
  img.onload = () => {
    _cachedEngine = DUCK;
  };
  img.src = "https://duckduckgo.com/favicon.ico";
}

function search(query: string) {
  const engine = getEngine();
  globalThis.open(`${engine}${encodeURIComponent(query.trim())}`, "_blank");
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const [value, setValue] = createSignal("");
  const [open, setOpen] = createSignal(false);

  let inputRef!: HTMLInputElement;
  let barRef!: HTMLDivElement;

  const isNav = () => value().startsWith("/");
  const isSearch = () => value().startsWith("?");
  const queryText = () => (isNav() || isSearch() ? value().slice(1) : "");

  const matches = () =>
    isNav()
      ? NAV_ROUTES.filter(
          (r) =>
            r.label.includes(queryText()) ||
            r.desc.includes(queryText()) ||
            r.path.slice(1).includes(queryText()),
        )
      : [];

  const commit = () => {
    if (isSearch() && queryText()) {
      search(queryText());
    } else if (isNav() && matches().length > 0) {
      navigate(matches()[0].path);
    }
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    }
    if (e.key === "Enter") {
      commit();
    }
  };

  // 全局快捷键：Ctrl+K 或 直接键入 / / ? / ？
  const globalKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      openPalette();
      return;
    }

    // 不在输入框中时，/ 或 ? 或 ？ 直接打开面板
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
    }
  };

  onMount(() => {
    globalThis.addEventListener("keydown", globalKey);
    probeDuck();
  });
  onCleanup(() => globalThis.removeEventListener("keydown", globalKey));

  const openPalette = (initial = "") => {
    setOpen(true);
    setValue(initial);
    setTimeout(() => {
      inputRef?.focus();
      // 光标移到末尾
      if (initial) {
        inputRef?.setSelectionRange(initial.length, initial.length);
      }
    }, 0);
  };

  const close = () => {
    setOpen(false);
    setValue("");
  };

  // 点击外部关闭
  const onBarBlur = (e: FocusEvent) => {
    if (!barRef.contains(e.relatedTarget as Node)) {
      close();
    }
  };

  return (
    <div
      ref={barRef}
      class={styles.bar}
      classList={{ [styles.barOpen]: open() }}
      onFocusOut={onBarBlur}
    >
      {!open() ? (
        /* ── 收起态：触发器 ── */
        <button
          type="button"
          class={styles.trigger}
          onClick={() => openPalette()}
          title="命令面板 (Ctrl+K)"
        >
          <span class={styles.triggerHint}>/ 导航 &nbsp; ? 搜索</span>
          <kbd class={styles.kbd}>Ctrl+K</kbd>
        </button>
      ) : (
        /* ── 展开态：输入栏 ── */
        <div class={styles.inputWrap}>
          {/* 建议列表（上方弹出） */}
          {isNav() && matches().length > 0 && (
            <div class={styles.suggestions}>
              {matches().map((m) => (
                <button
                  type="button"
                  class={styles.suggestionItem}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    navigate(m.path);
                    close();
                  }}
                >
                  <span class={styles.sugLabel}>{m.label}</span>
                  <span class={styles.sugDesc}>{m.desc}</span>
                  <span class={styles.sugPath}>{m.path}</span>
                </button>
              ))}
            </div>
          )}

          {isNav() && queryText() && matches().length === 0 && (
            <div class={styles.suggestions}>
              <div class={styles.empty}>未匹配</div>
            </div>
          )}

          {isSearch() && queryText() && (
            <div class={styles.suggestions}>
              <div class={styles.searchHint}>
                <kbd>Enter</kbd> 搜索 「{queryText()}」
              </div>
            </div>
          )}

          {/* 输入行 */}
          <div class={styles.inputRow}>
            <span class={styles.prefix}>
              {isNav() ? "/" : isSearch() ? "?" : ""}
            </span>
            <input
              ref={inputRef}
              class={styles.input}
              placeholder={
                isNav()
                  ? "输入路由名称…"
                  : isSearch()
                    ? "输入搜索关键词…"
                    : "输入 / 导航 或 ? 搜索"
              }
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        </div>
      )}
    </div>
  );
}
