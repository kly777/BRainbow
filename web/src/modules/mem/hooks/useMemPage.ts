import { isTypingTarget, notifyError, tryAsync } from "@shared/utils";
import {
	type Accessor,
	createDeferred,
	createResource,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { getUpcomingCountsE, type UpcomingCounts } from "../api.ts";
import { useMemReview } from "./useMemReview.ts";

const UPCOMING_TTL = 60_000;

export interface MemPageApi {
	review: ReturnType<typeof useMemReview>;
	upcomingCounts: Accessor<UpcomingCounts | undefined>;
	showMnemonicSettings: Accessor<boolean>;
	setShowMnemonicSettings: (value: boolean) => void;
	nav: (dir: -1 | 1) => void;
	onKey: (e: KeyboardEvent) => void;
}

export function useMemPage(): MemPageApi {
	const review = useMemReview();
	const [showMnemonicSettings, setShowMnemonicSettings] = createSignal(false);

	let lastUpcomingAt = 0;
	let lastUpcoming: UpcomingCounts | null = null;
	const dueLen = createDeferred(() => review.due().length);
	const [upcomingCounts] = createResource(
		() => dueLen(),
		async () => {
			if (lastUpcoming && Date.now() - lastUpcomingAt < UPCOMING_TTL)
				return lastUpcoming;
			const result = await tryAsync(() => getUpcomingCountsE());
			if (result.ok) {
				lastUpcoming = result.value;
				lastUpcomingAt = Date.now();
				return result.value;
			}
			notifyError("获取待复习统计失败", result.error);
			return { within_8h: 0, within_24h: 0 };
		},
	);

	const nav = (dir: -1 | 1) => {
		const next = Math.min(
			Math.max(0, review.current() + dir),
			Math.max(0, review.due().length - 1),
		);
		review.setCurrent(next);
		review.setShowAnswer(false);
	};

	const onKey = (e: KeyboardEvent) => {
		if (isTypingTarget(e.target)) return;
		if (e.key === "ArrowLeft") nav(-1);
		else if (e.key === "ArrowRight") nav(1);
	};

	onMount(() => globalThis.addEventListener("keydown", onKey));
	onCleanup(() => globalThis.removeEventListener("keydown", onKey));

	return {
		review,
		upcomingCounts: () => upcomingCounts(),
		showMnemonicSettings,
		setShowMnemonicSettings,
		nav,
		onKey,
	};
}
