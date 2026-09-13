import Button from "@components/ui/atoms/Button.tsx";
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
 * 按钮复用 <Button variant="secondary" size="md">（原自写 .btn 只有
 * 高度 2rem 与 size=md 的 2.25rem 不同，为设计系统自用而收敛）。
 */
const SimplePagination: Component<SimplePaginationProps> = (props) => {
	return (
		<Show when={props.totalPages > 1}>
			<nav class={styles.pagination} aria-label="分页">
				<Button
					variant="secondary"
					size="md"
					disabled={props.page <= 1 || props.disabled}
					onClick={props.onPrev}
					ariaLabel="上一页"
				>
					<ChevronLeft size={14} /> 上一页
				</Button>
				<span class={styles.info}>
					第 {props.page} / {props.totalPages} 页（共 {props.total} 条）
				</span>
				<Button
					variant="secondary"
					size="md"
					disabled={props.page >= props.totalPages || props.disabled}
					onClick={props.onNext}
					ariaLabel="下一页"
				>
					下一页 <ChevronRight size={14} />
				</Button>
			</nav>
		</Show>
	);
};

export default SimplePagination;
