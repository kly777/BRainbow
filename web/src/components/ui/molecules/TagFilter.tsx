import Input from "@components/ui/atoms/Input.tsx";
import styles from "@components/ui/molecules/TagFilter.module.css";
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js";
import type { TagOption } from "./TagInput.tsx";

interface Props {
	/** 当前筛选项的值（空串 = 不过滤） */
	value: string;
	onChange: (tag: string) => void;
	/** 一次取全量的标签选项 */
	options: Accessor<readonly TagOption[] | undefined>;
	/** 候选行显示使用计数 */
	showCount?: boolean;
	/**
	 * 追加一个"无标签"候选：值由调用方定（要能进 URL / 传给后端），
	 * 触发按钮上显示它的 label。
	 */
	untagged?: { value: string; label: string };
	/** 挂到根元素上的类：模块用自己的主题色时在此设 `--tag-filter-accent` */
	class?: string;
}

/**
 * 标签筛选下拉：触发器显示当前筛选值，展开后搜索 + 选标签。
 *
 * 合并自 `file` 与 `bookmark` 两份**同构**实现：模板逐行相同，差异只有
 * 三条 —— 候选带不带使用计数、要不要"无标签"这一项、强调色用不用模块色调
 * （bookmark 用 `--m-bookmark`）。三条都参数化了，于是收成一个组件。
 *
 * 标签选项由调用方取（`options` 收 accessor 而不是数组，避免把加载结果读死），
 * 这里不 import 任何 `@modules/*`。
 */
export default function TagFilter(props: Props) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");

	const filteredTags = createMemo(() => {
		const q = query().trim().toLowerCase();
		const all = props.options() ?? [];
		if (!q) return all;
		return all.filter((tag) => tag.name.toLowerCase().includes(q));
	});

	const displayLabel = () =>
		props.untagged && props.value === props.untagged.value
			? props.untagged.label
			: props.value || "全部标签";

	const select = (tag: string) => {
		props.onChange(tag);
		setOpen(false);
		setQuery("");
	};

	return (
		<div class={`${styles.wrapper}${props.class ? ` ${props.class}` : ""}`}>
			<button
				type="button"
				class={styles.trigger}
				onClick={() => setOpen((v) => !v)}
			>
				<span class={styles.triggerLabel}>{displayLabel()}</span>
				<span class={styles.triggerArrow}>{open() ? "▴" : "▾"}</span>
			</button>
			<Show when={open()}>
				<div class={styles.dropdown}>
					<div class={styles.searchWrap}>
						<Input
							class={styles.searchInput}
							placeholder="搜索标签…"
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
							aria-label="搜索标签"
							tone="bg"
						/>
					</div>
					<button
						type="button"
						class={`${styles.option} ${props.value === "" ? styles.optionActive : ""}`}
						onClick={() => select("")}
					>
						全部标签
					</button>
					<div class={styles.divider} />
					<For
						each={filteredTags()}
						fallback={
							<Show when={query().trim()}>
								<div class={styles.empty}>没有匹配的标签</div>
							</Show>
						}
					>
						{(tag) => (
							<button
								type="button"
								class={`${styles.option} ${props.value === tag.name ? styles.optionActive : ""}`}
								onClick={() => select(tag.name)}
							>
								<span class={styles.optionName}>{tag.name}</span>
								<Show when={props.showCount && tag.count !== undefined}>
									<span class={styles.optionCount}>{tag.count}</span>
								</Show>
							</button>
						)}
					</For>
					<Show when={props.untagged}>
						{(untagged) => (
							<>
								<div class={styles.divider} />
								<button
									type="button"
									class={`${styles.option} ${
										props.value === untagged().value ? styles.optionActive : ""
									}`}
									onClick={() => select(untagged().value)}
								>
									<span class={styles.optionName}>{untagged().label}</span>
								</button>
							</>
						)}
					</Show>
				</div>
			</Show>
		</div>
	);
}
