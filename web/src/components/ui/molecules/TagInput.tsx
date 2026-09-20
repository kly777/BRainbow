import Input from "@components/ui/atoms/Input.tsx";
import styles from "@components/ui/molecules/TagInput.module.css";
import {
	blurClose,
	filterTagOptions,
	hasExactTagMatch,
	tagEnterTarget,
} from "@shared/utils";
import {
	type Accessor,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";

/** 标签候选：id 供"删除标签"之类的操作识别，name 是标签本身 */
export interface TagOption {
	id: number;
	name: string;
	/** 使用计数（有则在下拉里显示） */
	count?: number;
}

interface Props {
	/** 已选标签名（chips 顺序即数组顺序） */
	selected: readonly string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
	/**
	 * 候选来源，二选一（`search` 优先）：
	 * - `allOptions`：**本地过滤** —— 一次取全量，输入时本地筛选。后端没有标签
	 *   搜索接口时用它（避免每个按键都请求一次全量）；
	 * - `search`：**远程搜索** —— 每次输入按 query 取候选。
	 */
	allOptions?: Accessor<readonly TagOption[] | undefined>;
	search?: (query: string) => Promise<TagOption[]>;
	/** 候选行显示使用计数（需候选项带 count） */
	showCount?: boolean;
	/**
	 * 候选行的删除入口（全局删除标签）。确认、提示、列表刷新都由调用方负责；
	 * 返回 `true` 表示确实删掉了 —— 组件据此重取候选列表。
	 */
	onDeleteOption?: (tag: TagOption) => Promise<boolean> | boolean;
	/** 是否提供"使用/创建该标签"的候选行（默认提供） */
	allowCreate?: boolean;
	placeholder?: string;
	ariaLabel?: string;
	class?: string;
}

const DEFAULT_PLACEHOLDER = "添加标签（Enter 确认，可创建新标签）…";

/**
 * 标签输入：chips + 候选下拉。
 *
 * 合并自 `file` 与 `bookmark` 两份**同构**实现（后者是前者的超集：多候选计数、
 * 候选行内删除、远程搜索）。两份的 DOM、类名、交互逐字相同，只有"候选从哪来"
 * 与"要不要删标签入口"不同 —— 差异全在 props 上，于是收成一个组件。
 *
 * 键控按 **name**（不是 id）：`file` / `bookmark` 的后端都是"提交名字数组，
 * 服务端按名字解析/自动创建"，选中态因此也用名字。`mem` 的标签是 id 键控、
 * chips 还带包含/排除三态，形态不同，走自己的组件，只共用
 * `shared/utils/tag-combo.ts` 的判定逻辑。
 *
 * 数据源与副作用都从外面注入：这里不 import 任何 `@modules/*`（共享层反向依赖
 * 模块会让模块 barrel 成环），删除标签的确认框/提示由调用方给。
 */
export default function TagInput(props: Props) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const trimmed = () => query().trim();

	// 远程模式：query 为空时 source 为 null，不发请求
	const [searchResults, { refetch }] = createResource(
		() => (props.search && trimmed() ? trimmed() : null),
		(q: string) => props.search?.(q) ?? Promise.resolve([]),
	);

	const options = (): readonly TagOption[] =>
		props.search ? (searchResults() ?? []) : (props.allOptions?.() ?? []);

	const suggestions = () =>
		filterTagOptions(options(), trimmed(), (option) =>
			props.selected.includes(option.name),
		);

	const hasExactMatch = () => hasExactTagMatch(options(), trimmed());

	const select = (name: string) => {
		props.onAdd(name);
		setQuery("");
		setOpen(false);
	};

	const submitText = () => {
		const name = trimmed();
		if (name) select(name);
	};

	const handleDelete = async (tag: TagOption) => {
		// 确认框接手前先收起下拉：否则它压在对话框上面，视觉上像没收起
		setOpen(false);
		const deleted = await props.onDeleteOption?.(tag);
		if (deleted) refetch();
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const target = tagEnterTarget(suggestions(), trimmed(), options());
			if (!target) return;
			select(target.kind === "option" ? target.option.name : target.text);
		}
		if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div class={`${styles.tagInput}${props.class ? ` ${props.class}` : ""}`}>
			<Show when={props.selected.length > 0}>
				<div class={styles.tags}>
					<For each={props.selected}>
						{(name) => (
							<span class={styles.tag}>
								{name}
								<button
									type="button"
									class={styles.tagRemove}
									onClick={() => props.onRemove(name)}
									title="移除标签"
								>
									×
								</button>
							</span>
						)}
					</For>
				</div>
			</Show>
			<div class={styles.inputRow}>
				<Input
					class={styles.input}
					placeholder={props.placeholder ?? DEFAULT_PLACEHOLDER}
					value={query()}
					onInput={(e) => {
						setQuery(e.currentTarget.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onBlur={blurClose(() => setOpen(false)).schedule}
					onKeyDown={handleKeyDown}
					aria-label={props.ariaLabel ?? "添加标签"}
				/>
			</div>
			<Show when={open() && trimmed().length > 0}>
				<div class={styles.dropdown}>
					<For each={suggestions()}>
						{(tag) => (
							<Show
								when={props.onDeleteOption}
								fallback={
									<button
										type="button"
										class={styles.dropdownItem}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => select(tag.name)}
									>
										<span class={styles.dropdownName}>{tag.name}</span>
									</button>
								}
							>
								{/* 有删除入口时拆成"选择 + 删除"两个按钮：删除不能顺带选中 */}
								<div class={styles.dropdownItem}>
									<button
										type="button"
										class={styles.dropdownSelect}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => select(tag.name)}
									>
										<span class={styles.dropdownName}>{tag.name}</span>
										<Show when={props.showCount && tag.count !== undefined}>
											<span class={styles.dropdownCount}>{tag.count}</span>
										</Show>
									</button>
									<button
										type="button"
										class={styles.dropdownDelete}
										title={`删除标签「${tag.name}」`}
										onMouseDown={(e) => e.stopPropagation()}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											void handleDelete(tag);
										}}
									>
										×
									</button>
								</div>
							</Show>
						)}
					</For>
					<Show when={props.allowCreate !== false && !hasExactMatch()}>
						<button
							type="button"
							classList={{
								[styles.dropdownItem]: true,
								[styles.createNew]: true,
							}}
							onMouseDown={submitText}
						>
							+ 使用"{trimmed()}"
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
