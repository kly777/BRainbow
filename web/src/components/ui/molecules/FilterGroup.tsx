import Button from "@components/ui/atoms/Button.tsx";
import styles from "@components/ui/molecules/FilterGroup.module.css";
import { For } from "solid-js";

interface FilterOption<T extends string> {
	value: T;
	label: string;
}

interface FilterGroupProps<T extends string> {
	options: readonly FilterOption<T>[];
	/** 当前选中项。必须来自 `options`，调用方拿到的 `onChange` 参数才收得窄 */
	selected: T;
	onChange: (value: T) => void;
	class?: string;
}

/**
 * 一组互斥的筛选按钮。
 *
 * 对取值类型**泛型**：调用方传的是联合类型（`FileCategoryFilter`、`SortOrder` 之类）
 * 时，`onChange` 收到的也是那个联合，不必在调用点写 `as`。用 `string` 的话
 * 窄类型传不进去（`(value: string) => void` 不接受 `(value: T) => void`），
 * 调用方只能靠断言把它转回来 —— 那正是这些类型想消掉的东西。
 */
function FilterGroup<T extends string>(props: FilterGroupProps<T>) {
	return (
		<div class={`${styles.group}${props.class ? ` ${props.class}` : ""}`}>
			<For each={props.options}>
				{({ value, label }) => (
					<Button
						variant={props.selected === value ? "primary" : "secondary"}
						size="sm"
						onClick={() => props.onChange(value)}
						aria-pressed={props.selected === value}
					>
						{label}
					</Button>
				)}
			</For>
		</div>
	);
}

export default FilterGroup;
