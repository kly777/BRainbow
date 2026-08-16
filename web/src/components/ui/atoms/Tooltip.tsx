import {
	createEffect,
	createSignal,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./Tooltip.module.css";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
	label: string;
	position?: TooltipPosition;
	delayMs?: number;
	children: JSX.Element;
}

const POSITION_CLASS: Record<TooltipPosition, string> = {
	top: styles.top,
	bottom: styles.bottom,
	left: styles.left,
	right: styles.right,
};

export default function Tooltip(props: TooltipProps) {
	const [visible, setVisible] = createSignal(false);
	const [pos, setPos] = createSignal<{ left: number; top: number } | null>(
		null,
	);
	let wrapRef: HTMLSpanElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const place = () => {
		const el = wrapRef;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const p = props.position ?? "top";
		let left = r.left + r.width / 2;
		let top = r.top;
		if (p === "bottom") top = r.bottom;
		if (p === "left") {
			left = r.left;
			top = r.top + r.height / 2;
		}
		if (p === "right") {
			left = r.right;
			top = r.top + r.height / 2;
		}
		setPos({ left, top });
	};

	const show = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			place();
			setVisible(true);
		}, props.delayMs ?? 300);
	};

	const hide = () => {
		clearTimeout(timer);
		setVisible(false);
		setPos(null);
	};

	createEffect(() => {
		if (!visible()) return;
		const onScroll = () => place();
		const onResize = () => place();
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		onCleanup(() => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		});
	});

	onCleanup(() => clearTimeout(timer));

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 仅作为 tooltip 承载层，hover/focus 用于显示气泡
		<span
			ref={wrapRef}
			class={styles.wrap}
			role="presentation"
			onMouseEnter={show}
			onMouseLeave={hide}
			onFocusIn={show}
			onFocusOut={hide}
		>
			{props.children}
			<Show when={visible() && pos()}>
				<Portal>
					<span
						class={`${styles.tip} ${POSITION_CLASS[props.position ?? "top"]}`}
						style={{ left: `${pos()!.left}px`, top: `${pos()!.top}px` }}
						role="tooltip"
					>
						{props.label}
					</span>
				</Portal>
			</Show>
		</span>
	);
}
