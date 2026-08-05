import type { Component, JSX } from "solid-js";
import * as styles from "./Button.css.ts";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "icon";
type Size = "sm" | "md";

interface ButtonProps {
	variant?: Variant;
	size?: Size;
	disabled?: boolean;
	onClick?: (e: MouseEvent) => void;
	type?: "button" | "submit";
	title?: string;
	class?: string;
	children: JSX.Element;
}

const Button: Component<ButtonProps> = (props) => {
	return (
		<button
			type={props.type ?? "button"}
			class={`${styles.btn} ${styles.variants[props.variant ?? "secondary"]} ${styles.variants[props.size ?? "md"]}${props.class ? ` ${props.class}` : ""}`}
			disabled={props.disabled}
			onClick={props.onClick}
			title={props.title}
		>
			{props.children}
		</button>
	);
};

export default Button;
