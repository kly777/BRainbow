import type { Component, JSX } from "solid-js";
import styles from "./Badge.module.css";

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

interface BadgeProps {
	variant?: BadgeVariant;
	class?: string;
	children: JSX.Element;
}

const Badge: Component<BadgeProps> = (props) => {
	return (
		<span
			class={`${styles.badge} ${styles[props.variant ?? "default"]}${props.class ? ` ${props.class}` : ""}`}
		>
			{props.children}
		</span>
	);
};

export default Badge;
