/**
 * 文件名后缀提取（列表卡片用它替代通用文件图标，一眼看出文件类型）。
 */

/** 后缀显示字符上限（超长后缀截断，如 "jpeg2000" → "JPEG2"） */
const MAX_EXT_LEN = 5;

/**
 * 提取后缀名（大写，最长 5 字符）。
 * 无后缀（含 `.gitignore` 这类隐藏文件、结尾带点的名字）返回空串。
 */
export function fileExt(name: string): string {
	const dot = name.lastIndexOf(".");
	// dot <= 0：无后缀或隐藏文件（.bashrc）；dot 在末尾：形如 "name."
	if (dot <= 0 || dot === name.length - 1) return "";
	return name
		.slice(dot + 1)
		.toUpperCase()
		.slice(0, MAX_EXT_LEN);
}
