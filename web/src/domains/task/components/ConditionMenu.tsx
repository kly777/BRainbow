// ── 条件菜单：一个 `+` 打开的那一排"还能加什么" ──
//
// 它只负责**列选项**与键盘移动；选中之后要展开哪个编辑器、要不要关闭，
// 由宿主（任务行 / 录入框）决定 —— 两处的条件集合与后续动作不同。
//
// 为什么不是浮层：任务列表本身是一个 `overflow-y: auto` 的滚动容器，浮层要么被裁掉、
// 要么得接一套 Portal + 视口夹取。这里的菜单最多六项，就地展开不会盖住任何东西，
// 也不会把焦点扔到文档另一头。

import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { CONDITION_LABELS, type ConditionKey } from "../model/conditions.ts";
import styles from "./ConditionMenu.module.css";

export interface ConditionMenuExtra {
	key: string;
	label: string;
}

export interface ConditionMenuProps {
	/** 还能加的条件（顺序由 lib/conditions 的唯一口径给出） */
	conditions: readonly ConditionKey[];
	/** 条件之外的动作（子任务 / 父任务） */
	extras?: readonly ConditionMenuExtra[];
	onSelect: (key: string) => void;
	onClose: () => void;
	/** 打开时把焦点放到第一项（任务行用）；录入框刻意不抢焦点，见 CaptureInput */
	autoFocus?: boolean;
	/** 菜单标题；不传则只渲染选项 */
	label?: string;
}

const ConditionMenu: Component<ConditionMenuProps> = (props) => {
	let menuRef: HTMLDivElement | undefined;
	const [activeIndex, setActiveIndex] = createSignal(0);

	const buttons = () => [
		...(menuRef?.querySelectorAll<HTMLButtonElement>("button") ?? []),
	];

	const focusAt = (index: number) => {
		const list = buttons();
		if (list.length === 0) {
			return;
		}
		const next = (index + list.length) % list.length;
		setActiveIndex(next);
		list[next]?.focus();
	};

	onMount(() => {
		if (props.autoFocus) {
			focusAt(0);
		}
	});

	return (
		<div
			ref={menuRef}
			class={styles.menu}
			role="menu"
			aria-label={props.label ?? "添加条件"}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					props.onClose();
					return;
				}
				if (e.key === "ArrowRight" || e.key === "ArrowDown") {
					e.preventDefault();
					focusAt(activeIndex() + 1);
					return;
				}
				if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
					e.preventDefault();
					focusAt(activeIndex() - 1);
				}
			}}
		>
			<Show when={props.label}>
				<span class={styles.title}>{props.label}</span>
			</Show>
			<div class={styles.items}>
				<For each={props.conditions}>
					{(key) => (
						<button
							type="button"
							role="menuitem"
							class={styles.item}
							onClick={() => props.onSelect(key)}
							onFocus={() => {
								const index = props.conditions.indexOf(key);
								if (index >= 0) setActiveIndex(index);
							}}
						>
							{CONDITION_LABELS[key]}
						</button>
					)}
				</For>
				<Show when={(props.extras?.length ?? 0) > 0}>
					<span class={styles.divider} aria-hidden="true" />
					<For each={props.extras}>
						{(extra) => (
							<button
								type="button"
								role="menuitem"
								class={styles.item}
								onClick={() => props.onSelect(extra.key)}
							>
								{extra.label}
							</button>
						)}
					</For>
				</Show>
			</div>
		</div>
	);
};

export default ConditionMenu;
