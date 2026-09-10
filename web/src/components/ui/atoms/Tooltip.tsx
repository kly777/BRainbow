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

/** 实例序号：生成跨实例唯一的 tooltip id */
let tipSeq = 0;

interface TooltipProps {
	/** 纯文本提示（与 content 二选一，content 优先） */
	label?: string;
	/** 富内容提示（多行信息卡），固定宽度并自动做视口水平夹取 */
	content?: JSX.Element;
	position?: TooltipPosition;
	delayMs?: number;
	/** 附加到宿主元素的类（需要撑满父容器时传入） */
	class?: string;
	children: JSX.Element;
}

const POSITION_CLASS: Record<TooltipPosition, string> = {
	top: styles.top,
	bottom: styles.bottom,
	left: styles.left,
	right: styles.right,
};

/** 富内容气泡宽度（px），与 Tooltip.module.css 的 .rich 保持一致，用于视口夹取 */
const RICH_TIP_WIDTH = 272;
/** 气泡与视口边缘的最小间距（px） */
const VIEWPORT_MARGIN = 8;

export default function Tooltip(props: TooltipProps) {
	const [visible, setVisible] = createSignal(false);
	const [pos, setPos] = createSignal<{ left: number; top: number } | null>(
		null,
	);
	let wrapRef: HTMLSpanElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** 富内容气泡较宽，水平居中后夹取到视口内，避免贴边被裁切 */
	const clampToViewport = (centerX: number) => {
		const half = RICH_TIP_WIDTH / 2;
		const min = VIEWPORT_MARGIN + half;
		const max = window.innerWidth - VIEWPORT_MARGIN - half;
		if (min > max) return centerX;
		return Math.min(Math.max(centerX, min), max);
	};

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
		if (props.content && (p === "top" || p === "bottom")) {
			left = clampToViewport(left);
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

	// 读屏可达：气泡 id 与 aria-describedby 关联（审计 F10）
	const tipId = `tooltip-${++tipSeq}`;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 仅作为 tooltip 承载层，hover/focus 用于显示气泡
		<span
			ref={wrapRef}
			class={props.class ? `${styles.wrap} ${props.class}` : styles.wrap}
			role="presentation"
			aria-describedby={visible() ? tipId : undefined}
			onMouseEnter={show}
			onMouseLeave={hide}
			onFocusIn={show}
			onFocusOut={hide}
		>
			{props.children}
			<Show when={visible() && pos()}>
				<Portal>
					<span
						id={tipId}
						class={`${styles.tip} ${props.content ? styles.rich : ""} ${POSITION_CLASS[props.position ?? "top"]}`}
						style={{ left: `${pos()?.left}px`, top: `${pos()?.top}px` }}
						role="tooltip"
					>
						{props.content ?? props.label}
					</span>
				</Portal>
			</Show>
		</span>
	);
}
