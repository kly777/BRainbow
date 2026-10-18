// ── 深链上下文：查看器按需读写"我在看哪儿" ──
//
// 查看器的契约是只接收 `{ item }`（见 types.ts），而 URL 读写是页面级能力 ——
// 所以走 context：详情页提供，需要深链的查看器自己取，取不到就退化成"只有本地状态"
// （查看器单测、其他调用点都不必造一个假路由）。
//
// 用 context 而不是往 props 里塞，与当初的 FileNavContext 同一个理由；区别是那个
// 已经被删掉（详情页不做跨文件导航），这个做的是**单个文件的视图状态**。

import { createContext, useContext } from "solid-js";

export interface ViewLink {
	/** 当前 URL 里属于该查看器的状态串（不是它的、或没有则 undefined） */
	state: (viewerId: string) => string | undefined;
	/** 写入 / 清除（`undefined` = 清除）；实现用 replace，不往后退栈里塞记录 */
	setState: (viewerId: string, value: string | number | undefined) => void;
}

export const ViewLinkContext = createContext<ViewLink>();

/** 取深链能力；不在详情页里（或没接 URL）时为 undefined */
export const useViewLink = () => useContext(ViewLinkContext);
