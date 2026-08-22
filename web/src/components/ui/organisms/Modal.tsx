import styles from "@components/ui/organisms/Modal.module.css";
import {
	type Component,
	createEffect,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: JSX.Element;
	actions?: JSX.Element;
}

const ModalHeader: Component<{ title: string; onClose: () => void }> = (
	props,
) => (
	<div class={styles.modalHeader}>
		<h2 id="modal-title" class={styles.modalTitle}>
			{props.title}
		</h2>
		<button
			type="button"
			class={styles.modalClose}
			onClick={props.onClose}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					props.onClose();
				}
			}}
			aria-label="关闭"
		>
			×
		</button>
	</div>
);

const ModalFooter: Component<{ actions?: JSX.Element }> = (props) => (
	<Show when={props.actions}>
		<div class={styles.modalFooter}>{props.actions}</div>
	</Show>
);

const Modal: Component<ModalProps> = (props) => {
	// 焦点管理（审计 F6）：打开移焦入对话框、Tab 在对话框内圈闭、关闭还原焦点。
	// Escape 挂 document——焦点已在子树内，原 overlay 监听永远收不到事件。
	// 已知限制：多层 Modal 叠开时 Escape 会逐层全关。
	let overlayRef: HTMLDivElement | undefined;
	let lastFocused: HTMLElement | null = null;
	const FOCUSABLE =
		'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

	const onDocKeydown = (e: KeyboardEvent) => {
		if (!overlayRef) return;
		if (e.key === "Escape") {
			props.onClose();
			return;
		}
		if (e.key !== "Tab") return;
		const items = [...overlayRef.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === overlayRef)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	createEffect(() => {
		if (props.isOpen) {
			lastFocused = document.activeElement as HTMLElement | null;
			queueMicrotask(() => overlayRef?.focus());
			document.addEventListener("keydown", onDocKeydown);
		} else {
			document.removeEventListener("keydown", onDocKeydown);
			lastFocused?.focus?.();
			lastFocused = null;
		}
	});
	onCleanup(() => document.removeEventListener("keydown", onDocKeydown));

	return (
		<Show when={props.isOpen}>
			<Portal>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘等价操作（Escape/Tab 圈闭）由 document 级 onDocKeydown 提供 */}
				<div
					ref={overlayRef}
					class={styles.modalOverlay}
					onClick={props.onClose}
					role="dialog"
					aria-modal="true"
					aria-labelledby="modal-title"
					tabIndex={-1}
				>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: 仅阻止冒泡防点内误关；键盘语义由 document 级监听统一提供 */}
					<div
						class={styles.modalContent}
						onClick={(e) => e.stopPropagation()}
						role="document"
					>
						<ModalHeader title={props.title} onClose={props.onClose} />
						<div class={styles.modalBody}>{props.children}</div>
						<ModalFooter actions={props.actions} />
					</div>
				</div>
			</Portal>
		</Show>
	);
};

export default Modal;
