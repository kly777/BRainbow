import { Button } from "@components/ui";
import { type Component, For } from "solid-js";
import { PAGE_SIZES } from "../tableConfig";
import styles from "./PaginationBar.module.css";

interface PaginationBarProps {
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
	filtered: boolean;
	loading: boolean;
	jumpValue: string;
	onJumpInput: (value: string) => void;
	onJump: (page: number) => void;
	onPageSizeChange: (size: number) => void;
	onPrev: () => void;
	onNext: () => void;
}

const PaginationBar: Component<PaginationBarProps> = (props) => {
	return (
		<div class={styles.pagination}>
			<span class={styles.paginationInfo}>
				{props.filtered ? `匹配 ${props.total} 行` : `共 ${props.total} 行`}· 第{" "}
				{props.page} / {props.totalPages} 页
			</span>
			<label class={styles.pageSize}>
				每页
				<select
					class={styles.pageSizeSelect}
					value={String(props.pageSize)}
					onChange={(e) =>
						props.onPageSizeChange(Number(e.currentTarget.value))
					}
				>
					<For each={PAGE_SIZES}>
						{(size) => <option value={size}>{size}</option>}
					</For>
				</select>
			</label>
			<form
				class={styles.pageJump}
				onSubmit={(e) => {
					e.preventDefault();
					const n = Number(props.jumpValue);
					props.onJump(
						Number.isInteger(n)
							? Math.min(Math.max(1, n), props.totalPages)
							: props.page,
					);
				}}
			>
				<input
					type="number"
					class={styles.pageJumpInput}
					min="1"
					max={props.totalPages}
					value={props.jumpValue}
					onInput={(e) => props.onJumpInput(e.currentTarget.value)}
					aria-label="跳转页码"
				/>
				<Button
					variant="secondary"
					size="sm"
					type="submit"
					disabled={props.loading}
				>
					跳转
				</Button>
			</form>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.page <= 1 || props.loading}
				onClick={props.onPrev}
			>
				上一页
			</Button>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.page >= props.totalPages || props.loading}
				onClick={props.onNext}
			>
				下一页
			</Button>
		</div>
	);
};

export default PaginationBar;
