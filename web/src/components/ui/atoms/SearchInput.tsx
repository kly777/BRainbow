import Input from "@components/ui/atoms/Input.tsx";
import styles from "@components/ui/atoms/SearchInput.module.css";
import { debounce, SEARCH_DEBOUNCE_MS } from "@shared/utils";
import type { Component } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";

interface SearchInputProps {
	value: string;
	onSearch: (value: string) => void;
	placeholder?: string;
	debounceMs?: number;
	class?: string;
}

const SearchInput: Component<SearchInputProps> = (props) => {
	const [local, setLocal] = createSignal(props.value);
	// debounceMs 为静态 prop，创建期读取一次即可
	const emitSearch = debounce(
		(v: string) => props.onSearch(v.trim()),
		props.debounceMs ?? SEARCH_DEBOUNCE_MS,
	);

	createEffect(() => {
		setLocal(props.value);
	});

	onCleanup(() => emitSearch.cancel());

	const handleInput = (value: string) => {
		setLocal(value);
		emitSearch(value);
	};

	return (
		<Input
			type="search"
			class={`${styles.input}${props.class ? ` ${props.class}` : ""}`}
			placeholder={props.placeholder ?? "搜索…"}
			aria-label={props.placeholder ?? "搜索"}
			value={local()}
			onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
		/>
	);
};

export default SearchInput;
