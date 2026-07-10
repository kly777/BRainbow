import type { JSX, Component } from "solid-js";
import styles from "./Button.module.css";

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
			class={`${styles.btn} ${styles[props.variant ?? "secondary"]} ${styles[props.size ?? "md"]}${props.class ? ` ${props.class}` : ""}`}
			disabled={props.disabled}
			onClick={props.onClick}
			title={props.title}
		>
			{props.children}
		</button>
	);
};

export default Button;
