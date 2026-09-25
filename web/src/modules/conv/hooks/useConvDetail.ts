import { useDetailResource } from "@shared/utils";
import { useParams } from "@solidjs/router";
import type { Accessor } from "solid-js";
import { getConvDetailE } from "../api.ts";
import { useBackHref } from "./useBackHref.ts";

export interface ConvDetailApi {
	data: Accessor<Awaited<ReturnType<typeof getConvDetailE>> | undefined>;
	/** Accessor：见 useDetailResource（首次加载才为真，后台刷新走 refreshing） */
	dataLoading: Accessor<boolean>;
	dataError: Accessor<unknown>;
	refetch: () => void;
	backHref: () => string;
}

export function useConvDetail(): ConvDetailApi {
	const params = useParams();
	// 详情取数走共享原语：它保证"有错误时 loading 必为假"（否则页面会卡骨架屏），
	// 并区分首次加载（骨架）与后台刷新（保留旧内容）
	const detail = useDetailResource<
		Awaited<ReturnType<typeof getConvDetailE>>,
		string | undefined
	>({
		id: () => params.id,
		validate: (id) => Boolean(id),
		fetcher: (id) => getConvDetailE(Number(id)),
		invalidIdError: new Error("无效的对话 ID"),
	});
	const backHref = useBackHref();

	return {
		data: detail.data,
		dataLoading: detail.loading,
		dataError: detail.error,
		refetch: detail.refetch,
		backHref,
	};
}
