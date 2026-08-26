import styles from "@components/ui/atoms/Badge.module.css";
import type { Component, JSX } from "solid-js";

type BadgeVariant =
	| "default"
	| "new"
	| "learning"
	| "review"
	| "relearning"
	| "suspended"
	| "success"
	| "warning";

// vanilla-extract 命名导出不支持动态索引，用映射表
const variantClass: Record<BadgeVariant, string> = {
	default: styles.default,
	new: styles.new,
	learning: styles.learning,
	review: styles.review,
	relearning: styles.relearning,
	suspended: styles.suspended,
	success: styles.success,
	warning: styles.warning,
};

interface BadgeProps {
	variant?: BadgeVariant;
	children: JSX.Element;
}

const Badge: Component<BadgeProps> = (props) => {
	return (
		<span class={`${styles.badge} ${variantClass[props.variant ?? "default"]}`}>
			{props.children}
		</span>
	);
};

export default Badge;
