// ── 文件查看器的类型契约 ──
//
// 「加一个文件类型的预览」= 往 registry.ts 的表里加一条记录 + 写一个查看器组件。
// 判定（match）只有这一处，兜底面板由 pickViewer 的返回值派生——不再需要手写
// "不是以上任何一种"的负向条件（那正是加类型时最容易漏改、且漏改后无报错的地方）。

import type { Component } from "solid-js";
import type { FileItem } from "../api.ts";

/**
 * 查看器组件：只接收文件记录。
 * 内容获取由组件自己挑 hooks（usePreviewUrl 管图片/音视频/PDF 的 URL 与私密换 blob，
 * 文本类走 usePreviewText），好处是每个查看器不必重复解决凭据与错误态。
 */
export type ViewerComponent = Component<{ item: FileItem }>;

export interface Viewer {
	/** 稳定标识：契约测试标注、以及将来的 ?view= 深链用 */
	id: string;
	/** 命中即用；多个命中时按注册表顺序取第一个 */
	match: (f: FileItem) => boolean;
	component: ViewerComponent;
}
