import { type Component, type JSX, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./Modal.module.css";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: JSX.Element;
    actions?: JSX.Element;
}

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
                    <div class={styles.modalBody}>{props.children}</div>
                    <Show when={props.actions}>
                        <div class={styles.modalFooter}>{props.actions}</div>
                    </Show>
                </div>
            </div>
            </Portal>
        </Show>
    );
};

export default Modal;
