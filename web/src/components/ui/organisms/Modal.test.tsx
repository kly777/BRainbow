// @vitest-environment jsdom

// ── Modal 焦点管理回归（审计 F6/T4）──
// 覆盖：打开移焦入对话框、Escape 关闭、Tab 圈闭、关闭还原焦点。
import Modal from "@components/ui/organisms/Modal";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise((r) => setTimeout(r, 0));

type Harness = {
	onClose: ReturnType<typeof vi.fn>;
	setOpen: (v: boolean) => void;
	dispose: () => void;
};

function mountModal(initialOpen: boolean): Harness {
	const onClose = vi.fn();
	let setOpenRef: (v: boolean) => void = () => {};

	const Host = () => {
		const [open, setOpen] = createSignal(initialOpen);
		setOpenRef = setOpen;
		return (
			<>
				<button id="opener" type="button">
					打开
				</button>
				<Modal isOpen={open()} onClose={onClose} title="测试对话框">
					<input id="field-a" />
					<button id="field-b" type="button">
						B
					</button>
				</Modal>
			</>
		);
	};
	const dispose = render(Host, document.body);
	return {
		onClose,
		setOpen: (v) => setOpenRef(v),
		dispose,
	};
}

const dialog = () => document.querySelector<HTMLDivElement>('[role="dialog"]');
const pressKey = (key: string, init: KeyboardEventInit = {}) =>
	document.dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Modal 焦点管理", () => {
	it("打开后焦点移入对话框", async () => {
		const h = mountModal(false);
		document.getElementById("opener")?.focus();
		h.setOpen(true);
		await flush();

		expect(dialog()).not.toBeNull();
		expect(document.activeElement).toBe(dialog());
		h.dispose();
	});

	it("Escape 派发后调用 onClose", async () => {
		const h = mountModal(true);
		await flush();

		pressKey("Escape");
		expect(h.onClose).toHaveBeenCalledTimes(1);
		h.dispose();
	});

	it("Tab 在末尾元素处圈回首个元素", async () => {
		const h = mountModal(true);
		await flush();

		// 末尾元素 = field-b；圈回的首个元素是标题栏关闭按钮
		const last = document.getElementById("field-b") as HTMLButtonElement;
		last.focus();
		pressKey("Tab");
		const items = dialog()!.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
		);
		expect(document.activeElement).toBe(items[0]);
		h.dispose();
	});

	it("Shift+Tab 在首个元素处圈回末尾元素", async () => {
		const h = mountModal(true);
		await flush();

		// 首个元素是标题栏关闭按钮；Shift+Tab 圈到末尾 = field-b
		const items = dialog()!.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
		);
		(items[0] as HTMLElement).focus();
		pressKey("Tab", { shiftKey: true });
		expect(document.activeElement?.id).toBe("field-b");
		h.dispose();
	});

	it("关闭后焦点还原到打开前的元素", async () => {
		const h = mountModal(false);
		const opener = document.getElementById("opener") as HTMLButtonElement;
		opener.focus();

		h.setOpen(true);
		await flush();
		expect(document.activeElement).toBe(dialog());

		h.setOpen(false);
		await flush();
		expect(document.activeElement).toBe(opener);
		h.dispose();
	});
});
