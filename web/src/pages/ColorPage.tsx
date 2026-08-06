/**
 * ColorPage — 主题/配色切换页（/color）
 */
import { createSignal, For, onMount } from "solid-js";
import { themes, type ThemeName } from "@styles/theme.ts";
import { applyTheme, getTheme, themeInfo } from "@styles/theme.ts";
import baseStyles from "@styles/base.module.css";
import styles from "./ColorPage.module.css";

export default function ColorPage() {
	const [current, setCurrent] = createSignal<ThemeName>(getTheme());

	onMount(() => setCurrent(getTheme()));

	const select = (name: ThemeName) => {
		applyTheme(name);
		setCurrent(name);
	};

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>配色方案</h1>
			<p class={styles.desc}>
				选择全局配色主题。切换即时生效并持久化到本地（不影响他人）， 当前主题：
				<code>{current()}</code>
			</p>

			<div class={styles.grid}>
				<For
					each={
						Object.entries(themes) as [ThemeName, (typeof themes)[ThemeName]][]
					}
				>
					{([name, info]) => (
						// biome-ignore lint/a11y/useSemanticElements: 卡片含嵌套交互元素，button 语义不适用
						<div
							class={`${styles.card} ${current() === name ? styles.cardActive : ""}`}
							onClick={() => select(name)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => e.key === "Enter" && select(name)}
						>
							<div class={styles.swatchRow}>
								<For each={info.swatches}>
									{(bg) => (
										<div class={styles.swatch} style={{ background: bg }} />
									)}
								</For>
							</div>
							<div class={styles.cardName}>{info.label}</div>
							<div class={styles.cardStatus}>
								{current() === name ? "✓ 当前" : "点击切换"}
							</div>
							<div class={styles.previewBox}>
								<span class={`${styles.previewBtn} ${styles.previewAccent}`}>
									主按钮
								</span>
								<span class={`${styles.previewBtn} ${styles.previewMuted}`}>
									描边按钮
								</span>
								<span class={`${styles.previewBtn} ${styles.previewPlain}`}>
									普通
								</span>
							</div>
						</div>
					)}
				</For>
			</div>

			<div class={styles.footer}>
				<button
					type="button"
					class={baseStyles.btnGhost}
					onClick={() => {
						applyTheme("paper");
						setCurrent("paper");
					}}
				>
					重置为默认
				</button>
				<span class={styles.footerHint}>{themeInfo(current()).label}</span>
			</div>
		</div>
	);
}
