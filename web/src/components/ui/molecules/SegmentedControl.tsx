import { For } from "solid-js";
import styles from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string> {
	value: T;
	label: string;
	count?: number;
}

export interface SegmentedControlProps<T extends string> {
	options: readonly SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
	ariaLabel: string;
	class?: string;
}

/** 范围/视图切换的统一切段控件。 */
export default function SegmentedControl<T extends string>(
	props: SegmentedControlProps<T>,
) {
	return (
		<div
			class={`${styles.root}${props.class ? ` ${props.class}` : ""}`}
			role="group"
			aria-label={props.ariaLabel}
		>
			<For each={props.options}>
				{(option) => (
					<button
						type="button"
						class={styles.option}
						classList={{ [styles.active]: props.value === option.value }}
						aria-pressed={props.value === option.value}
						onClick={() => props.onChange(option.value)}
					>
						{option.label}
						<ShowCount
							count={option.count}
							active={props.value === option.value}
						/>
					</button>
				)}
			</For>
		</div>
	);
}

function ShowCount(props: { count?: number; active: boolean }) {
	if (props.count === undefined) return null;
	return (
		<span
			class={styles.count}
			classList={{ [styles.countActive]: props.active }}
		>
			{props.count}
		</span>
	);
}
