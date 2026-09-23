/**
 * 图片灯箱：列表/详情里点图放大查看。
 * 支持左右切换同批图片、ESC/点击背景关闭、下载与复制链接。
 * 刻意不用 backdrop-filter（全屏模糊合成会让弹层出现明显卡顿）。
 */

import { Button } from "@components/ui";
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	X,
	ZoomIn,
	ZoomOut,
} from "@components/ui/icons";
import { copyTextWithToast, formatBytes } from "@shared/utils";
import {
	type Component,
	createEffect,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { FileItem } from "../api.ts";
import { usePreviewUrl } from "../hooks/usePreviewUrl.ts";
import {
	canZoomIn,
	canZoomOut,
	clampScale,
	MIN_SCALE,
	pixelPercent,
	stepScale,
	toggledScale,
	zoomedScroll,
} from "../lib/lightboxZoom.ts";
import styles from "./ImageLightbox.module.css";

interface Props {
	/** 可浏览的图片集合（通常是当前页的图片；详情页传单张 → 不出翻页按钮） */
	items: FileItem[];
	/** 当前图片索引 */
	index: number;
	onClose: () => void;
	/** 切到第 index 张。单张浏览（详情页）时不传 —— 比传一个空函数诚实 */
	onNavigate?: (index: number) => void;
}

const ImageLightbox: Component<Props> = (props) => {
	const current = () => props.items[props.index];
	const url = (item: FileItem) => item.url;
	// 私密图片不能直接进 <img src>（不带凭据会 401），这里换成 blob URL
	const preview = usePreviewUrl(
		() => {
			const item = current();
			return item ? url(item) : "";
		},
		() => current()?.is_private ?? false,
	);

	const go = (delta: number) => {
		const next = props.index + delta;
		if (next < 0 || next >= props.items.length) return;
		props.onNavigate?.(next);
	};

	/**
	 * 焦点管理（模态的基本礼貌，此前完全没有）：
	 * - 打开时把焦点收进对话框（否则 Tab 会跑到遮罩背后的页面上去，而 `aria-modal`
	 *   已经声明了外面是惰性的）；
	 * - 关闭时**还给打开它的那个元素**（列表里是缩略图/卡片、详情页是图片）——
	 *   否则焦点回到 body，键盘用户要重新 Tab 一路找回来。
	 */
	let closeBtnRef: HTMLButtonElement | undefined;
	let previouslyFocused: HTMLElement | null = null;

	const focusables = (): HTMLElement[] =>
		Array.from(
			overlayRef?.querySelectorAll<HTMLElement>(
				"button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
			) ?? [],
		);

	onMount(() => {
		previouslyFocused = document.activeElement as HTMLElement | null;
		closeBtnRef?.focus();
	});

	/**
	 * 关闭：**先让父组件卸载，再把焦点还给打开它的元素**（列表里是缩略图、详情页是图片）。
	 *
	 * 顺序不能反：卸载时 Solid 会移走这段 DOM，而被移走的正是当前焦点元素（关闭按钮），
	 * 浏览器顺手把焦点丢回 body —— 先回填、后卸载的话，那一次就被盖掉了。
	 */
	const close = () => {
		props.onClose();
		previouslyFocused?.focus();
	};

	// 兜底：因别的原因被卸载（路由切换）时也尽量把焦点还回去
	onCleanup(() => {
		queueMicrotask(() => previouslyFocused?.focus());
	});

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === "Tab") {
			// 简单的焦点环：在首尾之间回绕，别让焦点跑到遮罩外面
			const items = focusables();
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && active === first) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first?.focus();
			} else if (active && !overlayRef?.contains(active)) {
				// 焦点在遮罩外（比如从背后元素 Tab 进来）：拉回对话框内
				e.preventDefault();
				first?.focus();
			}
		}
		if (e.key === "ArrowLeft") {
			e.preventDefault();
			go(-1);
		}
		if (e.key === "ArrowRight") {
			e.preventDefault();
			go(1);
		}
	};

	document.addEventListener("keydown", onKeyDown);
	onCleanup(() => document.removeEventListener("keydown", onKeyDown));

	/** 点击遮罩空白处关闭；点在图片/工具条/导航上不关闭 */
	const onOverlayClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest("[data-lightbox-keep]")) return;
		close();
	};

	// 图片变化时重置滚动位置与缩放（大图超出视口时可滚动查看细节）
	let imgWrapRef!: HTMLDivElement;
	let overlayRef: HTMLDivElement | undefined;
	/** 适应窗口时的渲染尺寸：缩放以它为基准，避免"小图一放大就爆" */
	const [baseSize, setBaseSize] = createSignal<{ w: number; h: number }>();
	const [naturalWidth, setNaturalWidth] = createSignal(0);
	const [scale, setScale] = createSignal(MIN_SCALE);

	const imgStyle = () => {
		const base = baseSize();
		if (!base || scale() === MIN_SCALE) return undefined; // 适应窗口：交给 CSS
		return {
			width: `${base.w * scale()}px`,
			"max-width": "none",
			"max-height": "none",
		};
	};

	const onImgLoad = (e: Event) => {
		const el = e.currentTarget as HTMLImageElement;
		// offsetWidth 是"适应窗口"下的渲染宽度（CSS 只限制不超过容器）
		setBaseSize({ w: el.offsetWidth, h: el.offsetHeight });
		setNaturalWidth(el.naturalWidth);
	};

	/** 双击：适应 ↔ 原始像素（1:1）。`oneToOne` 由适应尺寸与原图尺寸之比得到 */
	const toggleFit = () => {
		const base = baseSize();
		const natural = naturalWidth();
		const oneToOne = base && natural > 0 ? natural / base.w : 1;
		setScale(toggledScale(scale(), oneToOne));
	};

	const applyZoom = (next: number, pointer?: { x: number; y: number }) => {
		const wrap = imgWrapRef;
		const prev = scale();
		const clamped = clampScale(next);
		if (clamped === prev) return;
		const ratio = clamped / prev;
		if (pointer) {
			// 以指针为中心：指针下的内容留在指针处（公式见 lib/lightboxZoom.ts）
			const box = wrap.getBoundingClientRect();
			const nextLeft = zoomedScroll(
				pointer.x - box.left,
				wrap.scrollLeft,
				ratio,
			);
			const nextTop = zoomedScroll(pointer.y - box.top, wrap.scrollTop, ratio);
			setScale(clamped);
			// 等布局把新尺寸应用上再滚动，否则滚的是旧的可滚动范围
			queueMicrotask(() => {
				wrap.scrollLeft = nextLeft;
				wrap.scrollTop = nextTop;
			});
			return;
		}
		setScale(clamped);
	};

	/** 滚轮缩放（只在灯箱上生效，不滚页面） */
	const onWheel = (e: WheelEvent) => {
		if (e.deltaY === 0) return;
		e.preventDefault();
		applyZoom(stepScale(scale(), e.deltaY < 0 ? 1 : -1), {
			x: e.clientX,
			y: e.clientY,
		});
	};

	createEffect(() => {
		void props.index;
		// 用 scrollTop/scrollLeft 而不是 scrollTo({ top: 0, left: 0 })：语义相同，
		// 但 jsdom 没有 Element.scrollTo，测试里会抛 "scrollTo is not a function"
		// 并被记成 unhandled error（同模块的 useListScroll / FindOverlay 都是这个写法）
		imgWrapRef.scrollTop = 0;
		imgWrapRef.scrollLeft = 0;
		// 换图回到适应窗口（每张图的尺寸不同，保留上一张的倍率毫无意义）
		setScale(MIN_SCALE);
		setBaseSize(undefined);
	});

	return (
		<Portal>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘等价操作是 Esc（见 keydown 监听） */}
			<div
				ref={(el) => {
					overlayRef = el;
				}}
				class={styles.overlay}
				role="dialog"
				aria-modal="true"
				aria-label="图片预览"
				onClick={onOverlayClick}
				onWheel={onWheel}
			>
				<div class={styles.stage} data-lightbox-keep>
					{/* keyed 不能省：翻页时 current() 从"一个对象换成另一个对象"，真假没变，
						    非 keyed 的 Show 不会重建子节点，于是 <img> 的 src/alt 都停在第一张
						    （公开图片的 url 还是同步替换真值，内层 Show 同理）。 */}
					<Show when={current()} keyed>
						{(item) => (
							<div class={styles.imgWrap} ref={imgWrapRef}>
								<Show
									when={!preview.error()}
									fallback={
										<div class={styles.error}>
											<p>{preview.error()?.message}</p>
											<Show when={preview.error()?.retryable}>
												<Button
													variant="secondary"
													size="sm"
													onClick={preview.retry}
												>
													重试
												</Button>
											</Show>
										</div>
									}
								>
									<Show
										when={preview.url()}
										keyed
										fallback={
											<Show when={item.is_private}>
												<p class={styles.loading}>正在加载私密图片…</p>
											</Show>
										}
									>
										{(src) => (
											<img
												src={src}
												alt={item.original_name}
												class={`${styles.img} ${scale() > MIN_SCALE ? styles.imgZoom : ""}`}
												style={imgStyle()}
												onLoad={onImgLoad}
												onDblClick={toggleFit}
											/>
										)}
									</Show>
								</Show>
							</div>
						)}
					</Show>
				</div>

				<Show when={props.items.length > 1}>
					<button
						type="button"
						class={`${styles.nav} ${styles.navPrev}`}
						disabled={props.index <= 0}
						data-lightbox-keep
						onClick={() => go(-1)}
						aria-label="上一张"
					>
						<ChevronLeft size={22} />
					</button>
					<button
						type="button"
						class={`${styles.nav} ${styles.navNext}`}
						disabled={props.index >= props.items.length - 1}
						data-lightbox-keep
						onClick={() => go(1)}
						aria-label="下一张"
					>
						<ChevronRight size={22} />
					</button>
				</Show>

				<div class={styles.bar} data-lightbox-keep>
					<Show when={current()}>
						{(item) => (
							<>
								<span class={styles.name} title={item().original_name}>
									{item().original_name}
								</span>
								<span class={styles.meta}>
									{props.index + 1} / {props.items.length} ·{" "}
									{formatBytes(item().size_bytes)}
								</span>
								{/* 缩放：滚轮（以指针为中心）/ 双击 / 按钮都能用。百分比按**原始像素**算，
								    所以"适应窗口"时读到 12% 是正常的，双击到 1:1 才是 100% */}
								<span class={styles.zoom}>
									<Button
										variant="icon"
										title="缩小"
										ariaLabel="缩小图片"
										disabled={!canZoomOut(scale())}
										onClick={() => applyZoom(stepScale(scale(), -1))}
									>
										<ZoomOut size={16} />
									</Button>
									<button
										type="button"
										class={styles.zoomValue}
										title="回到适应窗口"
										disabled={scale() === MIN_SCALE}
										onClick={() => applyZoom(MIN_SCALE)}
									>
										{pixelPercent(
											(baseSize()?.w ?? 0) * scale(),
											naturalWidth(),
										)}
										%
									</button>
									<Button
										variant="icon"
										title="放大（双击图片可在适应窗口与原始像素间切换）"
										ariaLabel="放大图片"
										disabled={!canZoomIn(scale())}
										onClick={() => applyZoom(stepScale(scale(), 1))}
									>
										<ZoomIn size={16} />
									</Button>
								</span>
								<Button
									variant="icon"
									title="复制文件链接"
									onClick={() => copyTextWithToast(url(item()))}
								>
									<Copy size={16} />
								</Button>
								<Button
									variant="icon"
									title="下载"
									onClick={() => window.open(url(item()), "_blank")}
								>
									<Download size={16} />
								</Button>
							</>
						)}
					</Show>
					<Button
						variant="icon"
						title="关闭（Esc）"
						ref={(el: HTMLButtonElement) => {
							closeBtnRef = el;
						}}
						onClick={close}
					>
						<X size={16} />
					</Button>
				</div>
			</div>
		</Portal>
	);
};

export default ImageLightbox;
