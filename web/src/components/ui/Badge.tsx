import type { Component, JSX } from "solid-js";
import * as styles from "./Badge.css.ts";

type BadgeVariant =
	| "default"
	| "new"
	| "learning"
	| "review"
	| "relearning"
	| "suspended"
	| "success"
	| "warning"
	| "danger"
	| "info";

// vanilla-extract 命名导出不支持动态索引，用映射表
const variantClass: Record<BadgeVariant, string> = {
	default: styles.default_,
	new: styles.new_,
	learning: styles.learning,
	review: styles.review,
	relearning: styles.relearning,
	suspended: styles.suspended,
	success: styles.success,
	warning: styles.warning,
	danger: styles.danger,
	info: styles.info,
};

interface BadgeProps {
	variant?: BadgeVariant;
	class?: string;
	children: JSX.Element;
}

const Badge: Component<BadgeProps> = (props) => {
	return (
		<span
			class={`${styles.badge} ${variantClass[props.variant ?? "default"]}${props.class ? ` ${props.class}` : ""}`}
		>
			{props.children}
		</span>
	);
};

export default Badge;
