import type { Component } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import * as styles from "./SearchInput.css.ts";

interface SearchInputProps {
	value: string;
	onSearch: (value: string) => void;
	placeholder?: string;
	debounceMs?: number;
	class?: string;
}

const SearchInput: Component<SearchInputProps> = (props) => {
	const [local, setLocal] = createSignal(props.value);
	let timer: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		setLocal(props.value);
	});

	onCleanup(() => clearTimeout(timer));

	const handleInput = (value: string) => {
		setLocal(value);
		clearTimeout(timer);
		timer = setTimeout(
			() => props.onSearch(value.trim()),
			props.debounceMs ?? 300,
		);
	};

	return (
		<input
			type="search"
			class={`${styles.input}${props.class ? ` ${props.class}` : ""}`}
			placeholder={props.placeholder ?? "搜索…"}
			value={local()}
			onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
		/>
	);
};

export default SearchInput;
