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

/**
 * 按钮原语的 props。继承原生 button 属性是为了兑现"其余原生属性原样透传"这条契约：
 * 此前类型里只有手写的几个，`ref` / `aria-*` / `data-*` 传不进来（运行时能透传、
 * 类型上却报错），而 Input / Textarea / Select / Layout 都继承了各自的 HTMLAttributes。
 */
interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
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
