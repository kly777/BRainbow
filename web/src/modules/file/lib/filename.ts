/**
 * 文件名后缀提取与代码高亮语言判定。
 *
 * 「这个文件是不是文本」由后端决定（infer 魔数 + mime_guess 扩展名兜底，
 * 未知文本统一存为 text/plain），前端只看 mime 是否 text/*；
 * 这里只保留两件前端独有的事：卡片后缀徽章、代码预览的高亮语言。
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

/** 小写后缀（匹配用） */
function lowerExt(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

/** 扩展名 → highlight.js 语言名（未列出的按纯文本展示） */
const EXT_TO_LANG: Record<string, string> = {
	rs: "rust",
	py: "python",
	pyi: "python",
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	go: "go",
	java: "java",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	rb: "ruby",
	php: "php",
	sql: "sql",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	json: "json",
	jsonc: "json",
	yaml: "yaml",
	yml: "yaml",
	xml: "xml",
	html: "xml",
	htm: "xml",
	css: "css",
	scss: "css",
	md: "markdown",
	markdown: "markdown",
	vue: "xml",
	svelte: "xml",
};

/**
 * 该文件的 highlight.js 语言名；无对应语言返回空串（按纯文本展示）。
 * 无扩展名的特殊文件名按名字映射。
 */
export function codeLang(name: string): string {
	const lower = name.toLowerCase();
	const byName: Record<string, string> = {
		dockerfile: "dockerfile",
		makefile: "makefile",
	};
	if (byName[lower]) return byName[lower];
	return EXT_TO_LANG[lowerExt(lower)] ?? "";
}

/**
 * 已知是纯文本、但 MIME 不在后端白名单里的扩展名。
 * 后端对这些扩展名按 mime_guess 给出 `application/x-subrip` 这类非 text/* 类型，
 * 于是归入 other 类别、拿不到文本查看器——但内容就是文本，按十六进制看没有意义。
 * 清单刻意保守：只收"一定是文本"的格式（字幕、歌词、播放列表、日志、补丁）。
 */
const PLAIN_TEXT_EXTS = new Set([
	"srt",
	"vtt",
	"ass",
	"ssa",
	"sub",
	"lrc",
	"m3u",
	"m3u8",
	"log",
	"diff",
	"patch",
]);

/**
 * 是否是压缩包（注册表按扩展名认领；**内容判据在后端** —— 压缩包没有稳定的 MIME，
 * 浏览器对 .tar.gz 可能报空、application/gzip、x-tar 各种写法）。
 * `.tar.gz` / `.tgz` 这种双扩展名要一起认。
 */
export function isArchiveName(name: string): boolean {
	return /\.(zip|tar|tgz|tar\.gz)$/i.test(name.trim());
}

/** 是否是 SQLite 数据库（注册表按扩展名认领；内容判据在后端，见 preview.rs） */
export function isSqliteName(name: string): boolean {
	return /\.(sqlite|sqlite3|db)$/i.test(name.trim());
}

/** 文件名是否属于"已知是纯文本"的扩展名（只看名字，不看内容） */
export function isPlainTextName(name: string): boolean {
	return PLAIN_TEXT_EXTS.has(lowerExt(name));
}

/** 生成 Markdown 代码围栏：围栏长度取内容中最长反引号串 + 1（避免内容截断围栏） */
export function codeFence(text: string, lang: string): string {
	let longest = 0;
	let run = 0;
	for (const ch of text) {
		if (ch === "`") {
			run += 1;
			if (run > longest) longest = run;
		} else {
			run = 0;
		}
	}
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${lang}\n${text}\n${fence}`;
}
