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
	/** 输入法组字中（拼音的每个音节都会发 input 事件） */
	const [composing, setComposing] = createSignal(false);
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
		// 组字中不搜：搜的是拼音中间态，既白费请求又会让列表反复闪；
		// compositionend 那一下才是用户真正打完的词
		if (!composing()) emitSearch(value);
	};

	return (
		<Input
			type="search"
			class={`${styles.input}${props.class ? ` ${props.class}` : ""}`}
			placeholder={props.placeholder ?? "搜索…"}
			aria-label={props.placeholder ?? "搜索"}
			value={local()}
			onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
			onCompositionStart={() => setComposing(true)}
			onCompositionEnd={(e) => {
				setComposing(false);
				// 立刻搜一次（不等防抖）：顺手取消组字前残留的那个定时器，
				// 免得它带着旧文本再搜一遍
				emitSearch.cancel();
				props.onSearch((e.target as HTMLInputElement).value.trim());
			}}
		/>
	);
};

export default SearchInput;
