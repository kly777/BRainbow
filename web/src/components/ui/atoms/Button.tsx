import styles from "@components/ui/atoms/Button.module.css";
import { type Component, type JSX, splitProps } from "solid-js";

type Variant =
	| "primary"
	| "secondary"
	| "outline"
	| "danger"
	| "dangerSolid"
	| "warningSolid"
	| "ghost"
	| "icon";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
	primary: styles.primary,
	secondary: styles.secondary,
	outline: styles.outline,
	danger: styles.danger,
	dangerSolid: styles.dangerSolid,
	warningSolid: styles.warningSolid,
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
	// 其余原生属性（ref / aria-* / data-* 等）原样透传：
	// ConfirmModal 就需要 ref 来做初始焦点，缺了它就只能自己手写 <button>
	const [local, rest] = splitProps(props, [
		"variant",
		"size",
		"class",
		"ariaLabel",
		"children",
	]);
	return (
		<button
			{...rest}
			type={props.type ?? "button"}
			class={`${styles.btn} ${VARIANT_CLASS[local.variant ?? "secondary"]} ${SIZE_CLASS[local.size ?? "md"]}${local.class ? ` ${local.class}` : ""}`}
			aria-label={local.ariaLabel}
		>
			{local.children}
		</button>
	);
};

export default Button;
