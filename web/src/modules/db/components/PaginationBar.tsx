import { ChevronLeft, ChevronRight } from "@components/ui/icons";
import { type Component, For, onCleanup, onMount, Show } from "solid-js";
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
	// Keyboard shortcuts: left/right arrows for page nav
	const handleKeyDown = (e: KeyboardEvent) => {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		) {
			return;
		}
		if (e.key === "ArrowLeft" && props.page > 1 && !props.loading) {
			e.preventDefault();
			props.onPrev();
		} else if (
			e.key === "ArrowRight" &&
			props.page < props.totalPages &&
			!props.loading
		) {
			e.preventDefault();
			props.onNext();
		}
	};

	onMount(() => {
		document.addEventListener("keydown", handleKeyDown);
		onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
	});

	return (
		<div class={styles.pagination}>
			<div class={styles.paginationInfo}>
				<span class={styles.infoTotal}>
					{props.filtered ? "匹配" : "共"}{" "}
					<span class={styles.infoCount}>{props.total}</span> 行
				</span>
				<Show when={props.totalPages > 1}>
					<span class={styles.infoSep}>·</span>
					<span class={styles.infoPage}>
						{props.page} / {props.totalPages}
					</span>
				</Show>
			</div>

			<div class={styles.paginationControls}>
				<label class={styles.pageSize}>
					<span class={styles.pageSizeLabel}>每页</span>
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

				<Show when={props.totalPages > 1}>
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
							placeholder="页码"
						/>
						<button
							type="submit"
							class={styles.pageJumpBtn}
							disabled={props.loading}
						>
							跳转
						</button>
					</form>

					<div class={styles.pageNav}>
						<button
							type="button"
							class={styles.pageNavBtn}
							disabled={props.page <= 1 || props.loading}
							onClick={props.onPrev}
							title="上一页"
						>
							<ChevronLeft size={14} />
						</button>
						<button
							type="button"
							class={styles.pageNavBtn}
							disabled={props.page >= props.totalPages || props.loading}
							onClick={props.onNext}
							title="下一页"
						>
							<ChevronRight size={14} />
						</button>
					</div>
				</Show>
			</div>
		</div>
	);
};

export default PaginationBar;
