import {
	type ControlSize,
	type ControlTone,
	controlClass,
	useControlField,
} from "@components/ui/atoms/control.ts";
import { type JSX, splitProps } from "solid-js";

export interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
	size?: ControlSize;
	tone?: ControlTone;
	/** 等宽字族（代码、哈希、数值） */
	mono?: boolean;
	/** 无效态；在 Field 内且 Field 有 error 时自动为 true */
	invalid?: boolean;
}

/**
 * 文本输入原语。样式见 Control.module.css（基础类特异度为 0，调用方类必定生效）。
 *
 * 放进 `<Field>` 时会自动获得 `id`（label 的 for 指向它）与
 * `aria-describedby`（指向 hint / error 文案），无需手写 —— 这是本原语
 * 相对裸 `<input>` 的主要价值：改造前全站 93 个文本控件里有 27 个没有可访问名。
 */
export default function Input(props: InputProps) {
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
		<input
			{...rest}
			id={local.id ?? field?.id}
			aria-describedby={rest["aria-describedby"] ?? field?.describedBy()}
			aria-invalid={invalid() || undefined}
			class={controlClass({
				class: local.class,
				size: local.size,
				tone: local.tone,
				mono: local.mono,
				invalid: invalid(),
			})}
		/>
	);
}
