import { createEffect, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import * as styles from "@components/ui/ConfirmModal.css.ts";
import type { ConfirmVariant } from "@components/ui/confirmStore.ts";
import { confirms } from "@components/ui/confirmStore.ts";

// ==================== 图标/样式映射 ====================

const ICON: Record<ConfirmVariant, string> = {
	danger: "⚠",
	warning: "⚠",
	info: "ℹ",
};

const BTN_CLASS: Record<ConfirmVariant, string> = {
	danger: styles.btnDanger,
	warning: styles.btnWarning,
	info: styles.btnPrimary,
};

const ICON_CLASS: Record<ConfirmVariant, string> = {
	danger: styles.iconDanger,
	warning: styles.iconWarning,
	info: styles.iconInfo,
};

const DEFAULT_CONFIRM: Record<ConfirmVariant, string> = {
	danger: "删除",
	warning: "确认",
	info: "确认",
};

// ==================== 组件 ====================

export default function ConfirmModalContainer() {
	return (
		<Show when={confirms().length > 0}>
			<Portal>
				<For each={confirms()}>{(item) => <ConfirmDialog item={item} />}</For>
			</Portal>
		</Show>
	);
}

function ConfirmDialog(props: {
	item: {
		id: number;
		options: import("@components/ui/confirmStore.ts").ConfirmOptions;
		resolve: (v: boolean) => void;
	};
}) {
	const { options, resolve } = props.item;
	const variant = options.variant ?? "info";

	// 焦点陷阱 + Escape 关闭
	let dialogRef!: HTMLDivElement;
	let cancelBtnRef!: HTMLButtonElement;

	createEffect(() => {
		// 自动聚焦取消按钮
		cancelBtnRef?.focus();
	});

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			resolve(false);
		}
		// 基础焦点陷阱
		if (e.key === "Tab") {
			const focusable = dialogRef.querySelectorAll<HTMLElement>(
				"button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
			);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first?.focus();
			}
		}
	};

	onCleanup(() => {
		// 确保组件卸载时 resolve
	});

	return (
		<div
			class={styles.overlay}
			onClick={() => resolve(false)}
			onKeyDown={onKeyDown}
			role="dialog"
			aria-modal="true"
			aria-labelledby={`confirm-title-${props.item.id}`}
			aria-describedby={`confirm-msg-${props.item.id}`}
		>
			<div
				ref={dialogRef}
				class={styles.dialog}
				role="document"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={onKeyDown}
			>
				<div class={styles.header}>
					<div class={`${styles.iconWrap} ${ICON_CLASS[variant]}`}>
						{ICON[variant]}
					</div>
					<div class={styles.titleWrap}>
						<h2 id={`confirm-title-${props.item.id}`} class={styles.title}>
							{options.title}
						</h2>
						<p id={`confirm-msg-${props.item.id}`} class={styles.message}>
							{options.message}
						</p>
					</div>
				</div>

				<div class={styles.actions}>
					<button
						ref={cancelBtnRef}
						type="button"
						class={`${styles.btn} ${styles.btnCancel}`}
						onClick={() => resolve(false)}
					>
						{options.cancelLabel ?? "取消"}
					</button>
					<button
						type="button"
						class={`${styles.btn} ${BTN_CLASS[variant]}`}
						onClick={() => resolve(true)}
					>
						{options.confirmLabel ?? DEFAULT_CONFIRM[variant]}
					</button>
				</div>
			</div>
		</div>
	);
}
