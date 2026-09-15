import { Button } from "@components/ui";
import { X } from "@components/ui/icons";
import { type Component, For, Show } from "solid-js";
import styles from "../FileList.module.css";
import type { UploadTask } from "../hooks/useFileList.ts";

/** 上传进度面板：批量/大文件时显示每个文件的进度与结果 */
const UploadPanel: Component<{
	tasks: () => UploadTask[];
	onClose: () => void;
}> = (props) => {
	const percent = (loaded: number, size: number) =>
		size === 0 ? 0 : Math.min(100, Math.round((loaded / size) * 100));
	const label = (status: string) =>
		status === "done"
			? "完成"
			: status === "duplicate"
				? "已存在"
				: status === "error"
					? "失败"
					: status === "rejected"
						? "未上传"
						: status === "pending"
							? "排队中"
							: "上传中";

	return (
		<Show when={props.tasks().length > 0}>
			<div class={styles.uploadPanel}>
				<div class={styles.uploadPanelHead}>
					<span>上传（{props.tasks().length}）</span>
					<Button variant="icon" title="收起" onClick={props.onClose}>
						<X size={14} />
					</Button>
				</div>
				<ul class={styles.uploadList}>
					<For each={props.tasks()}>
						{(t) => (
							<li class={styles.uploadItem}>
								<div class={styles.uploadItemHead}>
									<span class={styles.uploadName} title={t.name}>
										{t.name}
									</span>
									<span class={styles.uploadStatus}>
										{label(t.status)}
										{t.status === "uploading"
											? ` ${percent(t.loaded, t.size)}%`
											: ""}
									</span>
								</div>
								<div class={styles.uploadBar}>
									<div
										classList={{
											[styles.uploadBarFill]: true,
											[styles.uploadBarDone]: t.status === "done",
											[styles.uploadBarDup]: t.status === "duplicate",
											// 预校验拦下与上传失败的观感一致（都没成），共用红色
											[styles.uploadBarError]:
												t.status === "error" || t.status === "rejected",
										}}
										style={{
											width:
												t.status === "done" || t.status === "duplicate"
													? "100%"
													: `${percent(t.loaded, t.size)}%`,
										}}
									/>
								</div>
								<Show when={t.error}>
									<p class={styles.uploadError}>{t.error}</p>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</div>
		</Show>
	);
};

export default UploadPanel;
