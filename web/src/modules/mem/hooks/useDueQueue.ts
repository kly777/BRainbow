// ── 复习队列管理：加载 / 预取 / 前进 / 状态切换（stale-while-revalidate） ──

import type { DueResponse, MemItem } from "@modules/mem";
import { getSessionEstimateE } from "@modules/mem";
import { tryAsync } from "@shared/utils";
import { createSignal } from "solid-js";
import {
	insertRevisit,
	revisitGapFor,
	shouldDropRevisit,
} from "../lib/revisit.ts";

// 会话预估缓存：retention 重计算，60s 内不重复请求
const ESTIMATE_TTL = 60_000;
// 队列预取：剩余 ≤3 张时提前拉下一批，评完无缝衔接
const PREFETCH_THRESHOLD = 3;

export function useDueQueue(opts: {
	/** 拉取队列（参数由调用方组合标签过滤/最大学习量） */
	fetchDue: () => Promise<DueResponse>;
	/** 预估参数（与队列相同的标签过滤，保证预估口径一致） */
	estimateParams?: () => {
		tag_ids?: number[];
		exclude_tag_ids?: number[];
	};
	/** 当前卡变化时通知调用方（加载预览/助记） */
	onItemChange: (item: MemItem | undefined) => void;
}) {
	const [due, setDue] = createSignal<MemItem[]>([]);
	const [current, _setCurrent] = createSignal(0);
	const [showAnswer, _setShowAnswer] = createSignal(false);
	const [loading, setLoading] = createSignal(true);
	const [isPreview, setIsPreview] = createSignal(false);
	const [done, setDone] = createSignal(false);
	const [intervals, setIntervals] = createSignal<readonly number[]>([
		0, 0, 0, 0,
	]);
	const [allFar, setAllFar] = createSignal(false);
	const [upcoming, setUpcoming] = createSignal(0);
	const [estimatedTotal, setEstimatedTotal] = createSignal(0);
	const [estimatedSeconds, setEstimatedSeconds] = createSignal(0);

	let lastEstimateAt = 0;
	let lastEstimateKey = "";
	let prefetching = false;
	let prefetched: DueResponse | null = null;
	// 本轮已评卡片 id：预取结果可能含尚未评完的卡，复用前需过滤
	const reviewedIds = new Set<number>();
	// 本轮重插计数：同一张卡 Again/Hard 后最多回来几次
	const revisitCounts = new Map<number, number>();

	// 应用队列结果（loadDue / 预取复用共用）
	const applyQueue = (data: DueResponse) => {
		if (data.items.length === 0 && !data.has_more) {
			setDone(true);
			setDue([]);
			setEstimatedTotal(0);
			setUpcoming(data.upcoming_count ?? 0);
			reviewedIds.clear();
			revisitCounts.clear();
		} else {
			revisitCounts.clear();
			setDone(false);
			setAllFar(data.all_far);
			void (async () => {
				// 预估 60s 缓存；标签过滤变化时强制刷新，避免沿用旧口径
				const estimateParams = opts.estimateParams?.() ?? {};
				const estimateKey = `${estimateParams.tag_ids?.join(",") ?? ""}|${estimateParams.exclude_tag_ids?.join(",") ?? ""}`;
				if (
					Date.now() - lastEstimateAt < ESTIMATE_TTL &&
					estimateKey === lastEstimateKey
				) {
					return;
				}
				lastEstimateAt = Date.now();
				lastEstimateKey = estimateKey;
				const estResult = await tryAsync(() =>
					getSessionEstimateE(estimateParams),
				);
				if (estResult.ok) {
					setEstimatedTotal(estResult.value.total_estimate);
					setEstimatedSeconds(estResult.value.avg_seconds);
				}
				// 预估失败不影响复习
			})();
			setDue([...data.items]);
			_setCurrent(0);
			_setShowAnswer(false);
			setIsPreview(
				data.items.length === 1 && data.items[0]?.state !== "learning",
			);
			if (data.items.length > 0) {
				opts.onItemChange(data.items[0]);
			}
		}
		setLoading(false);
	};

	const loadDue = async () => {
		// stale-while-revalidate：已有卡片时不清空、不闪加载中，旧卡保持到新队列就绪
		if (due().length === 0) setLoading(true);

		// 预取复用：仅队列为空且预取已就绪（undo/标签切换时 due 非空，走正常网络拉取）
		if (due().length === 0 && prefetched) {
			const data = prefetched;
			prefetched = null;
			const fresh = data.items.filter((it) => !reviewedIds.has(it.id));
			if (fresh.length > 0) {
				applyQueue({ ...data, items: fresh });
				return;
			}
			// 预取全是已评卡：退回正常拉取
		}

		const dueResult = await tryAsync(() => opts.fetchDue());
		// 失败时若已有卡片则保留旧队列（stale-while-revalidate），仅空态标记加载结束
		if (!dueResult.ok) {
			setLoading(false);
			return;
		}
		applyQueue(dueResult.value);
	};

	// 剩余卡 ≤ 阈值且未在预取/已有缓存时，提前请求下一批
	const prefetchNext = () => {
		if (prefetching || prefetched) return;
		if (due().length === 0 || due().length > PREFETCH_THRESHOLD) return;
		prefetching = true;
		void tryAsync(() => opts.fetchDue()).then((r) => {
			prefetching = false;
			if (r.ok) prefetched = r.value;
		});
	};

	const advanceQueue = () => {
		setDue((prev) => {
			const next = [...prev];
			next.splice(current(), 1);
			return next;
		});
		// 剩余卡变短，触发下一批预取（队列空时 loadDue 直接复用缓存）
		prefetchNext();
		if (due().length > 0) {
			const nextItem = due()[current()];
			if (nextItem) opts.onItemChange(nextItem);
			_setShowAnswer(false);
		} else {
			loadDue();
		}
	};

	/** 评分 Again/Hard 后把当前卡重插到队列后面；达到上限则按正常消费移除 */
	const revisitCurrent = (rating: number) => {
		const it = due()[current()];
		if (!it) {
			advanceQueue();
			return;
		}
		const gap = revisitGapFor(rating, it.id);
		const count = revisitCounts.get(it.id) ?? 0;
		if (gap === 0 || shouldDropRevisit(count)) {
			reviewedIds.add(it.id);
			advanceQueue();
			return;
		}
		revisitCounts.set(it.id, count + 1);
		const { next, nextIndex } = insertRevisit(due(), current(), gap);
		setDue(next);
		_setShowAnswer(false);
		prefetchNext();
		const nextItem = due()[nextIndex];
		if (nextItem) opts.onItemChange(nextItem);
		else void loadDue();
	};

	return {
		due,
		current,
		showAnswer,
		loading,
		isPreview,
		done,
		intervals,
		setIntervals,
		allFar,
		upcoming,
		estimatedTotal,
		estimatedSeconds,
		reviewedIds,
		setDue,
		setCurrent: _setCurrent,
		setShowAnswer: _setShowAnswer,
		loadDue,
		advanceQueue,
		revisitCurrent,
		invalidateCache: () => {
			reviewedIds.clear();
			revisitCounts.clear();
			prefetched = null;
		},
	};
}
