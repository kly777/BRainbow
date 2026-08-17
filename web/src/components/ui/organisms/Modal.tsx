import styles from "@components/ui/organisms/Modal.module.css";
import { type Component, type JSX, Show } from "solid-js";
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
	return (
		<Show when={props.isOpen}>
			<Portal>
				<div
					class={styles.modalOverlay}
					onClick={props.onClose}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							props.onClose();
						}
					}}
					role="dialog"
					aria-modal="true"
					aria-labelledby="modal-title"
					tabIndex={-1}
				>
					<div
						class={styles.modalContent}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
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
