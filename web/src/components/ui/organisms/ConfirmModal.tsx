import Button from "@components/ui/atoms/Button.tsx";
import { AlertTriangle, Info } from "@components/ui/icons";
import type { ConfirmVariant } from "@components/ui/organisms/confirmStore.ts";
import { confirms } from "@components/ui/organisms/confirmStore.ts";
import { createEffect, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./ConfirmModal.module.css";

// ==================== 图标/样式映射 ====================

function IconForVariant(variant: ConfirmVariant) {
	const size = 20;
	switch (variant) {
		case "danger":
		case "warning":
			return <AlertTriangle size={size} />;
		case "info":
			return <Info size={size} />;
	}
}

/** 语义变体 → Button 的 variant。danger/warning 用实底变体（确认框的
    破坏性动作用实心按钮更醒目），info 用常规 primary。 */
const BTN_VARIANT: Record<
	ConfirmVariant,
	"dangerSolid" | "warningSolid" | "primary"
> = {
	danger: "dangerSolid",
	warning: "warningSolid",
	info: "primary",
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
		options: import("@components/ui").ConfirmOptions;
		resolve: (v: boolean) => void;
	};
}) {
	const { options, resolve } = props.item;
	const variant = options.variant ?? "info";

	// 焦点管理：保存打开前焦点，关闭/卸载时恢复
	let dialogRef!: HTMLDivElement;
	let cancelBtnRef!: HTMLButtonElement;
	let lastFocused: HTMLElement | null = null;

	createEffect(() => {
		// 组件挂载时保存当前焦点
		lastFocused = document.activeElement as HTMLElement | null;
		cancelBtnRef?.focus();
	});

	onCleanup(() => {
		lastFocused?.focus?.();
	});

	const doResolve = (v: boolean) => {
		resolve(v);
		lastFocused?.focus?.();
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			doResolve(false);
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

	return (
		<div
			class={styles.overlay}
			onClick={() => doResolve(false)}
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
						{IconForVariant(variant)}
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
					<Button
						ref={cancelBtnRef}
						variant="secondary"
						onClick={() => doResolve(false)}
					>
						取消
					</Button>
					<Button
						variant={BTN_VARIANT[variant]}
						onClick={() => doResolve(true)}
					>
						{options.confirmLabel ?? DEFAULT_CONFIRM[variant]}
					</Button>
				</div>
			</div>
		</div>
	);
}
