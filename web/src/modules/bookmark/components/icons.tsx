/**
 * Bookmark 模块 SVG 图标组件。
 * 基于 Lucide 路径，统一 16px / stroke-width 2 / currentColor。
 */

import type { Component, JSX } from "solid-js";

interface IconProps {
	size?: number;
	class?: string;
	style?: JSX.CSSProperties;
}

const defaultProps: IconProps = { size: 16 };

const Icon = (d: string): Component<IconProps> => {
	return (props) => {
		const p = { ...defaultProps, ...props };
		return (
			<svg
				width={p.size}
				height={p.size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class={p.class}
				style={p.style}
				aria-hidden="true"
			>
				<path d={d} />
			</svg>
		);
	};
};

const Icon2 = (d1: string, d2: string): Component<IconProps> => {
	return (props) => {
		const p = { ...defaultProps, ...props };
		return (
			<svg
				width={p.size}
				height={p.size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class={p.class}
				style={p.style}
				aria-hidden="true"
			>
				<path d={d1} />
				<path d={d2} />
			</svg>
		);
	};
};

// ── 具体图标 ──

/** ✕ 关闭 / 删除 */
export const IconX: Component<IconProps> = Icon2(
	"M18 6L6 18",
	"M6 6l12 12",
);

/** ✎ 编辑 */
export const IconPencil: Component<IconProps> = Icon2(
	"M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
	"m15 5 4 4",
);

/** 🔄 刷新 */
export const IconRefresh: Component<IconProps> = Icon2(
	"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
	"M3 3v5h5",
);

/** 🔗 链接 */
export const IconLink: Component<IconProps> = Icon2(
	"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
	"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
);

/** ⚙ 设置 */
export const IconSettings: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={p.style}
			aria-hidden="true"
		>
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
};

/** 🤖 Sparkles / AI */
export const IconSparkles: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={p.style}
			aria-hidden="true"
		>
			<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
			<path d="M5 3v4" />
			<path d="M19 17v4" />
			<path d="M3 5h4" />
			<path d="M17 19h4" />
		</svg>
	);
};

/** ⏳ 加载中 */
export const IconLoader: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={{
				...p.style,
				animation: "spin 1s linear infinite",
			}}
			aria-hidden="true"
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
};

/** ✅ 检查圆 */
export const IconCheckCircle: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={p.style}
			aria-hidden="true"
		>
			<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
			<path d="m9 11 3 3L22 4" />
		</svg>
	);
};

/** ❌ 叉圆 */
export const IconXCircle: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={p.style}
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10" />
			<path d="m15 9-6 6" />
			<path d="m9 9 6 6" />
		</svg>
	);
};

/** 全选 checkbox */
export const IconCheckSquare: Component<IconProps> = (props) => {
	const p = { ...defaultProps, ...props };
	return (
		<svg
			width={p.size}
			height={p.size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={p.class}
			style={p.style}
			aria-hidden="true"
		>
			<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
			<path d="m9 12 2 2 4-4" />
		</svg>
	);
};
