import styles from "./Spinner.module.css";

interface Props {
	/** 直径（px），默认 16 */
	size?: number;
	/** 环的粗细（px），默认 2 */
	thickness?: number;
	/** 随附的可见文案；传了就当 live region，没传则对读屏器隐藏 */
	label?: string;
	class?: string;
}

/**
 * 旋转等待指示器。
 *
 * 存在的理由：环形 spinner 的骨架（圆形 + 上边框着色 + `@keyframes` 旋转）在
 * command-palette / conv 等处各写一份，且 **CSS Modules 的 `@keyframes` 是文件作用域** ——
 * 在 A 文件里定义 `@keyframes spin`、在 B 文件里写 `animation: spin` 不会生效，
 * `/conv/search` 的 spinner 就这样静止了很久。收进原语后动画名与关键帧同文件，
 * 再也拆不开。
 *
 * 尺寸走 inline style 而不是类：调用方的直径是"这一处需要多大"的局部知识。
 *
 * 可访问名按场景给：旁边已有"搜索中…"之类可见文案时**别**传 label（那是装饰，
 * 传了会让读屏器读两遍）；独自占位（如 /conv/search 的加载态）时传 —— 此时
 * 它是页面在等待的唯一信号。role 恒定是 status，无 label 时整元素 aria-hidden。
 */
export default function Spinner(props: Props) {
	return (
		<span
			class={`${styles.spinner}${props.class ? ` ${props.class}` : ""}`}
			style={{
				width: `${props.size ?? 16}px`,
				height: `${props.size ?? 16}px`,
				"border-width": `${props.thickness ?? 2}px`,
			}}
			role="status"
			aria-label={props.label}
			aria-hidden={props.label ? undefined : "true"}
		/>
	);
}
