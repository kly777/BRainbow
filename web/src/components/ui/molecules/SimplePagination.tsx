import { ChevronLeft, ChevronRight } from "@components/ui/icons";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import styles from "./SimplePagination.module.css";

interface SimplePaginationProps {
	page: number;
	totalPages: number;
	total: number;
	onPrev: () => void;
	onNext: () => void;
	disabled?: boolean;
}

/**
 * 简单分页栏：上一页 / 页码信息 / 下一页。
 * 用于记忆管理、书签管理等不需要跳转和每页条数选择的场景。
 */
const SimplePagination: Component<SimplePaginationProps> = (props) => {
	return (
		<Show when={props.totalPages > 1}>
			<nav class={styles.pagination} aria-label="分页">
				<button
					type="button"
					class={styles.btn}
					disabled={props.page <= 1 || props.disabled}
					onClick={props.onPrev}
					aria-label="上一页"
				>
					<ChevronLeft size={14} /> 上一页
				</button>
				<span class={styles.info}>
					第 {props.page} / {props.totalPages} 页（共 {props.total} 条）
				</span>
				<button
					type="button"
					class={styles.btn}
					disabled={props.page >= props.totalPages || props.disabled}
					onClick={props.onNext}
					aria-label="下一页"
				>
					下一页 <ChevronRight size={14} />
				</button>
			</nav>
		</Show>
	);
};

export default SimplePagination;
