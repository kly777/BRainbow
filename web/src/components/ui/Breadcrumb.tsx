import { A } from "@solidjs/router";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import styles from "./Breadcrumb.module.css";

export interface Crumb {
  label: string;
  href?: string; // 可点击跳转；undefined 表示当前页
}

/** 面包屑导航：首页 > 卡片 > 详情 */
export default function Breadcrumb(props: { items: readonly Crumb[] }) {
  return (
    <nav class={styles.breadcrumb} aria-label="面包屑导航">
      <For each={props.items}>
        {(item, i) => (
          <>
            <Show
              when={item.href}
              fallback={<span class={styles.current}>{item.label}</span>}
            >
              <A href={item.href!} class={styles.link}>
                {item.label}
              </A>
            </Show>
            <Show when={i() < props.items.length - 1}>
              <span class={styles.sep}>›</span>
            </Show>
          </>
        )}
      </For>
    </nav>
  );
}
