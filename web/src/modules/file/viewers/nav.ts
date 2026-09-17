// ── "同批文件"的上下文：查看器按需取，拿不到就退回只看当前这张 ──
//
// 查看器的契约是只接收 `{ item }`（见 types.ts），这条约束值得保住 —— 它让每个查看器
// 都不必知道"自己是从哪儿打开的"。但灯箱需要在**同批图片**之间翻页，而那个列表只有
// 详情页知道（从来源 URL 还原出来的）。
//
// 所以用 context 而不是往 props 里塞：详情页提供，需要翻页的查看器自己取，
// 其余场景（查看器单测、直接打开详情页、其他调用点）拿到 undefined 后自然退化成
// "只有当前这张"，不需要任何空值判断的分支逻辑散落各处。

import { createContext, useContext } from "solid-js";
import type { FileItem } from "../api.ts";

export interface FileNav {
	/** 同批文件（来源列表的完整一页；来源不明时为空数组） */
	siblings: () => FileItem[];
	/** 切到同批文件里的某一条 */
	goTo: (item: FileItem) => void;
}

export const FileNavContext = createContext<FileNav>();

/** 取同批文件的导航能力；不在详情页里（或没有来源列表）时为 undefined */
export const useFileNav = () => useContext(FileNavContext);
