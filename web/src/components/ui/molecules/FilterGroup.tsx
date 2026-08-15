import styles from "@components/ui/molecules/FilterGroup.module.css";
import type { Component } from "solid-js";
import { For } from "solid-js";

interface FilterOption {
	value: string;
	label: string;
}

interface FilterGroupProps {
	options: FilterOption[];
	selected: string;
	onChange: (value: string) => void;
	class?: string;
}

const FilterGroup: Component<FilterGroupProps> = (props) => {
	return (
		<div class={`${styles.group}${props.class ? ` ${props.class}` : ""}`}>
			<For each={props.options}>
				{({ value, label }) => (
					<button
						type="button"
						class={
							props.selected === value
								? `${styles.btn} ${styles.active}`
								: styles.btn
						}
						onClick={() => props.onChange(value)}
						aria-pressed={props.selected === value}
					>
						{label}
					</button>
				)}
			</For>
		</div>
	);
};

export default FilterGroup;
