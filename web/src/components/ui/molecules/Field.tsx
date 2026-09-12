import { ControlFieldContext } from "@components/ui/atoms/control.ts";
import { Stack } from "@components/ui/atoms/Layout.tsx";
import styles from "@components/ui/molecules/Field.module.css";
import { createUniqueId, type JSX, Show } from "solid-js";

export interface FieldProps {
	/** 可见标签文本；同时作为控件的可访问名 */
	label: string;
	/** 辅助说明，控件未出错时显示并被 aria-describedby 引用 */
	hint?: string;
	/** 校验错误；存在时控件自动进入无效态（aria-invalid）并改由错误文案占据描述位 */
	error?: string;
	/** 显示必填标记（并在可访问名里补「必填」二字） */
	required?: boolean;
	/** 附加到外层容器的类，用于外边距等；不要在其中声明 flex / gap（由 Stack 接管） */
	class?: string;
	/** 单个表单控件；放进 Field 即自动获得 id / aria-describedby / aria-invalid */
	children: JSX.Element;
}

/**
 * 表单字段容器：标签 + 控件 + 提示/错误，并自动完成无障碍关联。
 *
 * 之所以做成原语而不是让各表单自己拼：改造前全站 93 个文本控件里
 * **27 个没有任何可访问名**（无 id、无 aria-label、也未被 label 包裹），
 * 多数只靠 placeholder —— 而 placeholder 输入后即消失、读屏器也不可靠，
 * 不能替代标签。把 id 生成与 aria-describedby 收进原语后，正确的关联
 * 成为默认行为，不再依赖每个调用点自觉。
 *
 * 布局用 Stack（gap=xs），不额外写 flex CSS。
 */
export default function Field(props: FieldProps) {
	const id = createUniqueId();
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;

	return (
		<ControlFieldContext.Provider
			value={{
				id,
				invalid: () => Boolean(props.error),
				// 出错时描述位让给错误文案，避免同时播报提示与错误
				describedBy: () =>
					props.error ? errorId : props.hint ? hintId : undefined,
			}}
		>
			<Stack class={props.class} gap="xs">
				<label class={styles.label} for={id}>
					{props.label}
					<Show when={props.required}>
						<span class={styles.required} aria-hidden="true">
							*
						</span>
						{/* 视觉上的星号对读屏器不可见，补一段仅供读屏器的「必填」，
						    这样即便调用方忘了给控件加 required 属性也不会丢信息 */}
						<span class="sr-only">必填</span>
					</Show>
				</label>
				{props.children}
				<Show
					when={props.error}
					fallback={
						<Show when={props.hint}>
							<p id={hintId} class={styles.hint}>
								{props.hint}
							</p>
						</Show>
					}
				>
					<p id={errorId} class={styles.error} role="alert">
						{props.error}
					</p>
				</Show>
			</Stack>
		</ControlFieldContext.Provider>
	);
}
