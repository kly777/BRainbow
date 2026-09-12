// ── 表单控件原语的共享内部机制 ──
//
// 放在 atoms 层（而非 Field 所在的 molecules 层）是为了不出现
// molecules → atoms 的反向依赖：Field（molecule）提供 context，
// Input / Select / Textarea（atoms）消费它，双方都只依赖本文件。

import styles from "@components/ui/atoms/Control.module.css";
import { type Accessor, createContext, useContext } from "solid-js";

export type ControlSize = "sm" | "md" | "lg";
export type ControlTone = "surface" | "bg";

/**
 * Field 注入给控件的关联信息。
 * - `id`：label 的 for 指向它，保证可访问名不依赖调用方手写 id
 * - `describedBy`：把 hint / error 文案挂到控件的 aria-describedby
 * - `invalid`：Field 有 error 时控件自动进入无效态
 */
export interface ControlFieldBinding {
	id: string;
	describedBy: Accessor<string | undefined>;
	invalid: Accessor<boolean>;
}

export const ControlFieldContext = createContext<ControlFieldBinding>();

/** 控件读取外层 Field 的绑定；不在 Field 内时为 undefined */
export function useControlField(): ControlFieldBinding | undefined {
	return useContext(ControlFieldContext);
}

const SIZE: Record<ControlSize, string | undefined> = {
	sm: styles.sizeSm,
	md: undefined, // md 是基础类的默认形态，不额外产生类名
	lg: styles.sizeLg,
};

const TONE: Record<ControlTone, string | undefined> = {
	surface: undefined,
	bg: styles.toneBg,
};

export function joinClass(...parts: (string | false | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export interface ControlClassOptions {
	/** 调用方自己的 CSS Module 类，最后拼接，便于覆盖 */
	class?: string;
	size?: ControlSize;
	tone?: ControlTone;
	mono?: boolean;
	invalid?: boolean;
}

/**
 * 组装控件的类名。
 * `modifier` 用于 Textarea / Select 这类形态附加类（可省）。
 */
export function controlClass(
	opts: ControlClassOptions,
	modifier?: string,
): string {
	return joinClass(
		styles.control,
		modifier,
		opts.size ? SIZE[opts.size] : undefined,
		opts.tone ? TONE[opts.tone] : undefined,
		opts.mono && styles.mono,
		opts.invalid && styles.invalid,
		opts.class,
	);
}
