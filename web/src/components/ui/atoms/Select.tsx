import styles from "@components/ui/atoms/Control.module.css";
import {
	type ControlSize,
	type ControlTone,
	controlClass,
	useControlField,
} from "@components/ui/atoms/control.ts";
import { type JSX, splitProps } from "solid-js";

export interface SelectProps
	extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
	size?: ControlSize;
	tone?: ControlTone;
	mono?: boolean;
	invalid?: boolean;
}

/**
 * 下拉选择原语（原生 `<select>`，保留键盘与移动端原生行为）。
 * 与 Input 同样自动接入外层 Field 的 id / aria-describedby / invalid。
 * 选项由调用方以 `<option>` 子节点提供。
 */
export default function Select(props: SelectProps) {
	const field = useControlField();
	const [local, rest] = splitProps(props, [
		"class",
		"size",
		"tone",
		"mono",
		"invalid",
		"id",
	]);
	const invalid = () => local.invalid ?? field?.invalid() ?? false;

	return (
		<select
			{...rest}
			id={local.id ?? field?.id}
			aria-describedby={rest["aria-describedby"] ?? field?.describedBy()}
			aria-invalid={invalid() || undefined}
			class={controlClass(
				{
					class: local.class,
					size: local.size,
					tone: local.tone,
					mono: local.mono,
					invalid: invalid(),
				},
				styles.select,
			)}
		/>
	);
}
