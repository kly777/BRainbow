// ── /file/:id：文件详情（左：文件展示主体，右：元信息侧栏） ──

import { AsyncSection, Button, DetailPage } from "@components/ui";
import { Copy, Download, Lock, Pencil, Unlock } from "@components/ui/icons";
import { copyTextWithToast, strParam, useUrlParams } from "@shared/utils";
import { Show } from "solid-js";
import FileEditForm from "./components/FileEditForm.tsx";
import FileInfoList from "./components/FileInfoList.tsx";
import styles from "./FileDetail.module.css";
import { useFileDetail } from "./hooks/useFileDetail.ts";
import { useSplitPane } from "./hooks/useSplitPane.ts";
import { buildViewParam, viewStateOf } from "./lib/viewLink.ts";
import { PreviewStage } from "./viewers/PreviewStage.tsx";
import { ViewLinkContext } from "./viewers/viewLink.ts";

export default function FileDetail() {
	const m = useFileDetail();

	/**
	 * 查看器内部状态的深链（P4-5）：`?view=<查看器id>:<状态串>`。
	 * 读用 get、写用 set —— 用 `useUrlParams` 的默认值语义，写回 "" 即从 URL 清除。
	 */
	const viewParams = useUrlParams({ view: strParam("") });
	const viewLink = {
		state: (viewerId: string) => viewStateOf(viewParams.get("view"), viewerId),
		setState: (viewerId: string, value: string | number | undefined) =>
			viewParams.set({
				view: value === undefined ? "" : buildViewParam(viewerId, value),
			}),
	};

	/** 两栏宽度：拖拽调宽 + 记住上次的宽度（分隔条也支持键盘微调） */
	const pane = useSplitPane();

	// 详情页是**单个文件**的页面：没有"上一个/下一个"（`/file/:id` 是文件汇集里的一条，
	// 相邻文件之间没有语义关系，给这种按钮只会让人误以为它们相关 —— 曾经有过，已移除）。
	// 浏览一组文件回列表页，那里的灯箱翻页按当前筛选结果来，语义成立。
	//
	// 也刻意**不**绑定 ←/→ 切文件：3DGS 预览用方向键移动相机（见 viewers/splat/controls.ts），
	// 全局快捷键会和它抢事件（回归测试断言方向键不切文件：FileDetail.render.test.tsx）。

	return (
		<DetailPage
			class={styles.container}
			title={m.data()?.original_name ?? "文件详情"}
			titleHidden
			backLabel="文件列表"
			onBack={m.handleBack}
			actions={
				<>
					<Button
						variant="icon"
						title="复制文件 URL（可用于 Markdown 引用）"
						onClick={() => {
							const f = m.data();
							if (f) copyTextWithToast(f.url);
						}}
					>
						<Copy size={14} />
					</Button>
					<Button
						variant="icon"
						title="下载文件"
						onClick={() => {
							const f = m.data();
							if (f) window.open(f.url, "_blank");
						}}
					>
						<Download size={14} />
					</Button>
					<Show when={m.data()?.can_edit}>
						<Button
							variant="icon"
							title={m.data()?.is_private ? "设为公开" : "设为私密"}
							disabled={m.saving()}
							onClick={() => void m.togglePrivate()}
						>
							<Show when={m.data()?.is_private} fallback={<Unlock size={14} />}>
								<Lock size={14} />
							</Show>
						</Button>
					</Show>
					<Show when={m.data()?.can_edit}>
						<Button
							variant="secondary"
							size="sm"
							onClick={m.startEdit}
							disabled={m.editing()}
						>
							<Pencil size={14} /> 编辑
						</Button>
					</Show>
					<Show when={m.data()?.can_edit}>
						<Button variant="danger" size="sm" onClick={m.remove}>
							删除
						</Button>
					</Show>
				</>
			}
		>
			<AsyncSection
				data={m.data}
				loading={() => m.dataLoading}
				error={() => m.dataError}
				refreshing={() => m.dataRefreshing}
				onRetry={m.refetch}
				class={styles.body}
				style={`--side-width: ${pane.sideWidth()}px`}
			>
				{(item) => (
					<>
						<section class={styles.previewPane} aria-label="文件预览">
							<ViewLinkContext.Provider value={viewLink}>
								<PreviewStage item={item()} />
							</ViewLinkContext.Provider>
						</section>
						{/* 分隔条：拖它调整两栏宽度；键盘用户可聚焦后按左右方向键微调（一次 16px）。
						    用 <hr> 而不是 div+role：**它的隐式角色就是 separator**（ARIA 的
						    window splitter 模式），浏览器与读屏都不必我们再去声明 */}
						<hr
							class={`${styles.splitter} ${pane.dragging() ? styles.splitterActive : ""}`}
							aria-orientation="vertical"
							aria-label="调整预览区与信息栏宽度"
							aria-valuenow={pane.sideWidth()}
							tabIndex={0}
							onPointerDown={pane.onDragStart}
							onKeyDown={pane.onKeyDown}
						/>
						<aside class={styles.sidePane} aria-label="文件信息">
							<Show
								when={m.editing()}
								fallback={<FileInfoList item={item()} />}
							>
								<FileEditForm m={m} />
							</Show>
						</aside>
					</>
				)}
			</AsyncSection>
		</DetailPage>
	);
}
