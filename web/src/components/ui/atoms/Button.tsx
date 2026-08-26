import styles from "@components/ui/atoms/Button.module.css";
import type { Component, JSX } from "solid-js";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "icon";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
	primary: styles.primary,
	secondary: styles.secondary,
	danger: styles.danger,
	ghost: styles.ghost,
	icon: styles.icon,
};

const SIZE_CLASS: Record<Size, string> = {
	sm: styles.sm,
	md: styles.md,
};

interface ButtonProps {
	variant?: Variant;
	size?: Size;
	disabled?: boolean;
	onClick?: (e: MouseEvent) => void;
	type?: "button" | "submit";
	title?: string;
	/** 图标按钮的无可见文案时的可访问名 */
	ariaLabel?: string;
	class?: string;
	children: JSX.Element;
}

const Button: Component<ButtonProps> = (props) => {
	return (
		<button
			type={props.type ?? "button"}
			class={`${styles.btn} ${VARIANT_CLASS[props.variant ?? "secondary"]} ${SIZE_CLASS[props.size ?? "md"]}${props.class ? ` ${props.class}` : ""}`}
			disabled={props.disabled}
			onClick={props.onClick}
			title={props.title}
			aria-label={props.ariaLabel}
		>
			{props.children}
		</button>
	);
};

export default Button;
