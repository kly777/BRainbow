import { createSignal } from "solid-js";

/**
 * 模态框状态管理：消除 `const [show, setShow] = createSignal(false)` + onClose 样板。
 *
 * @example
 *   const createModal = useModal();
 *   // JSX: <Modal isOpen={createModal.isOpen()} onClose={createModal.close}>
 *   // 触发: createModal.open()
 */
export function useModal(initialOpen = false) {
	const [isOpen, setIsOpen] = createSignal(initialOpen);
	return {
		isOpen,
		open: () => setIsOpen(true),
		close: () => setIsOpen(false),
		toggle: () => setIsOpen((v) => !v),
	};
}
