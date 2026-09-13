import Button from "@components/ui/atoms/Button.tsx";
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
};

export default FilterGroup;
