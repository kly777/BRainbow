// ── 剪贴板：复制文本（静默返回结果 / 带提示） ──

import { notifyError, notifySuccess } from "../errors/notify.ts";
import { tryAsync } from "./result.ts";

/** 复制文本到剪贴板，返回是否成功（不弹提示） */
export async function copyText(text: string): Promise<boolean> {
	const result = await tryAsync(() => navigator.clipboard.writeText(text));
	return result.ok;
}

/** 复制并弹提示（成功 "已复制" / 失败 "复制失败"） */
export async function copyTextWithToast(text: string): Promise<void> {
	if (await copyText(text)) {
		notifySuccess("已复制");
	} else {
		notifyError("复制失败");
	}
}
