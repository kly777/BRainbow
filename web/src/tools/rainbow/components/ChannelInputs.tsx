// ── 颜色通道输入行（RGB / HSL / OKLCH）：数值输入 + 滑块，滑块复用 onInput 提交 ──

import { Input } from "@components/ui";
import type { Accessor } from "solid-js";
import styles from "../ColorEditor.module.css";

export function RgbInputs(props: {
	r: Accessor<number>;
	g: Accessor<number>;
	b: Accessor<number>;
	onInput: (ch: "r" | "g" | "b", e: Event) => void;
	onFocus: () => void;
	onBlur: () => void;
}) {
	return (
		<span class={styles.triple}>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="255"
				value={props.r()}
				onInput={(e) => props.onInput("r", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="R 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="255"
				value={props.g()}
				onInput={(e) => props.onInput("g", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="G 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="255"
				value={props.b()}
				onInput={(e) => props.onInput("b", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="B 数值"
			/>
			<span class={styles.rangeHint}>0–255</span>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="255"
				step="1"
				value={props.r()}
				onInput={(e) => props.onInput("r", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="R"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="255"
				step="1"
				value={props.g()}
				onInput={(e) => props.onInput("g", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="G"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="255"
				step="1"
				value={props.b()}
				onInput={(e) => props.onInput("b", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="B"
			/>
		</span>
	);
}

export function HslInputs(props: {
	h: Accessor<number>;
	s: Accessor<number>;
	l: Accessor<number>;
	onInput: (ch: "h" | "s" | "l", e: Event) => void;
	onFocus: () => void;
	onBlur: () => void;
}) {
	return (
		<span class={styles.triple}>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="360"
				value={props.h()}
				onInput={(e) => props.onInput("h", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="H 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="100"
				value={props.s()}
				onInput={(e) => props.onInput("s", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="S 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="100"
				value={props.l()}
				onInput={(e) => props.onInput("l", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="L 数值"
			/>
			<span class={styles.rangeHint}>H:0–360 S/L:0–100</span>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="360"
				step="1"
				value={props.h()}
				onInput={(e) => props.onInput("h", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="H"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="100"
				step="1"
				value={props.s()}
				onInput={(e) => props.onInput("s", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="S"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="100"
				step="1"
				value={props.l()}
				onInput={(e) => props.onInput("l", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="L"
			/>
		</span>
	);
}

export function OklchInputs(props: {
	L: Accessor<number>;
	C: Accessor<number>;
	h: Accessor<number>;
	onInput: (ch: "L" | "C" | "h", e: Event) => void;
	onFocus: () => void;
	onBlur: () => void;
}) {
	return (
		<span class={styles.triple}>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="1"
				step="0.001"
				value={props.L()}
				onInput={(e) => props.onInput("L", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="L 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				step="0.001"
				value={props.C()}
				onInput={(e) => props.onInput("C", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="C 数值"
			/>
			<Input
				class={styles.channel}
				type="number"
				min="0"
				max="360"
				step="0.1"
				value={props.h()}
				onInput={(e) => props.onInput("h", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="H 数值"
			/>
			<span class={styles.rangeHint}>L:0–1 C:≥0 h:0–360</span>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={props.L()}
				onInput={(e) => props.onInput("L", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="L"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="0.4"
				step="0.005"
				value={props.C()}
				onInput={(e) => props.onInput("C", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="C"
			/>
			<input
				class={styles.slider}
				type="range"
				min="0"
				max="360"
				step="0.5"
				value={props.h()}
				onInput={(e) => props.onInput("h", e)}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				aria-label="H"
			/>
		</span>
	);
}
