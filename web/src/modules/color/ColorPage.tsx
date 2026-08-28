/**
 * ColorPage — 主题/配色切换页（/color）
 */

import {
	applyTheme,
	getTheme,
	type ThemeName,
	themeInfo,
	themes,
} from "@shared/styles";
import { Check } from "lucide-solid";
import { createSignal, For, onMount } from "solid-js";
import styles from "./ColorPage.module.css";

type ThemeInfo = (typeof themes)[ThemeName];
type ThemeEntry = [ThemeName, ThemeInfo];

function ThemeSwatchRow(props: { swatches: ThemeInfo["swatches"] }) {
	return (
		<div class={styles.swatchRow}>
			<For each={props.swatches}>
				{(bg) => <div class={styles.swatch} style={{ background: bg }} />}
			</For>
		</div>
	);
}

function ThemePreviewBox() {
	return (
		<div class={styles.previewBox}>
			<span class={`${styles.previewBtn} ${styles.previewAccent}`}>主按钮</span>
			<span class={`${styles.previewBtn} ${styles.previewMuted}`}>
				描边按钮
			</span>
			<span class={`${styles.previewBtn} ${styles.previewPlain}`}>普通</span>
		</div>
	);
}

function ThemeCard(props: {
	name: ThemeName;
	info: ThemeInfo;
	active: boolean;
	onSelect: (name: ThemeName) => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: 卡片含嵌套交互元素，button 语义不适用
		<div
			class={`${styles.card} ${props.active ? styles.cardActive : ""}`}
			onClick={() => props.onSelect(props.name)}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => e.key === "Enter" && props.onSelect(props.name)}
		>
			<ThemeSwatchRow swatches={props.info.swatches} />
			<div class={styles.cardName}>{props.info.label}</div>
			<div class={styles.cardStatus}>
				{props.active ? (
					<>
						<Check size={14} /> 当前
					</>
				) : (
					"点击切换"
				)}
			</div>
			<ThemePreviewBox />
		</div>
	);
}

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
				<For each={Object.entries(themes) as ThemeEntry[]}>
					{([name, info]) => (
						<ThemeCard
							name={name}
							info={info}
							active={current() === name}
							onSelect={select}
						/>
					)}
				</For>
			</div>

			<div class={styles.footer}>
				<button
					type="button"
					class={styles.btnGhost}
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
