import styles from "@components/ui/atoms/Control.module.css";
import {
	type ControlSize,
	type ControlTone,
	controlClass,
	useControlField,
} from "@components/ui/atoms/control.ts";
import { type JSX, splitProps } from "solid-js";

export interface TextareaProps
	extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
	size?: ControlSize;
	tone?: ControlTone;
	mono?: boolean;
	invalid?: boolean;
}

/**
 * 多行文本原语。默认 `resize: vertical` 与 `min-height`，行数用原生 `rows` 控制。
 * 与 Input 同样自动接入外层 Field 的 id / aria-describedby / invalid。
 */
export default function Textarea(props: TextareaProps) {
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
		<textarea
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
				styles.textarea,
			)}
		/>
	);
}
