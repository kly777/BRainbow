/**
 * MarkdownEditor 的文件能力（上传 + 从文件库挑选），供其它模块注入使用：
 *
 *   import { MarkdownFilePicker, uploadToFileService } from "@modules/file/markdown-editor-support.tsx";
 *   <MarkdownEditor onUploadFile={uploadToFileService} filePicker={MarkdownFilePicker} … />
 *
 * 编辑器本身不认识 file 模块——`components` 层不得反向依赖 `modules`（门禁见
 * `web/src/app/layer-boundaries.test.ts`），所以能力由使用方从这里注入。
 *
 * 放在模块根而不是 `components/` 下，有两条原因：
 * 1. 跨模块引用只认"根级公开入口"（页面与 root 级支撑件），`components/ hooks/ lib/`
 *    属内部实现，必须走 `index.ts` barrel —— 这条边界由上面那个门禁守着；
 * 2. 本文件只牵 `FilePickerModal` / `FileThumb` 两个小件，而 barrel 还会带出
 *    `FileList` / `FileDetail`（它们的 CSS 有副作用、摇不掉），导入方（卡片与记忆页）
 *    不该为了一次"插入文件"把整个文件模块拖进自己的 chunk。
 */

import type { MarkdownFileRef } from "@components/MarkdownEditor.tsx";
import { uploadFile } from "./api.ts";
import FilePickerModal from "./components/FilePickerModal.tsx";

/** 上传到通用文件服务（去重、白名单外的未知类型也能存）→ Markdown 引用 */
export async function uploadToFileService(
	file: File,
): Promise<MarkdownFileRef> {
	const uploaded = await uploadFile(file);
	return {
		url: uploaded.url,
		name: uploaded.original_name,
		mime: uploaded.mime_type,
	};
}

/** `MarkdownEditor` 的"插入文件"挑选器（签名与编辑器的 `filePicker` 一致） */
export function MarkdownFilePicker(props: {
	isOpen: boolean;
	onClose: () => void;
	onPick: (file: MarkdownFileRef) => void;
}) {
	return (
		<FilePickerModal
			isOpen={props.isOpen}
			onClose={props.onClose}
			onPick={props.onPick}
		/>
	);
}
