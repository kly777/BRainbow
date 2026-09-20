/**
 * 文件名后缀提取与代码高亮语言判定。
 *
 * 「这个文件是不是文本」由后端按**字节**判定（mime.rs 的 looks_like_text，
 * 先定族再定种，见 §3），文本一律存为 text/*；前端只看 mime 是否 text/*。
 * 高亮语言是前端独有的知识（highlight.js），所以这张表留在这里。
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

// 这里曾经有一份 PLAIN_TEXT_EXTS（srt / vtt / lrc / log / patch …）与配套的
// isPlainTextName：后端当时按 mime_guess 的映射表给 MIME，字幕这类扩展名拿到的是
// application/x-subrip（不是 text/*），前端只好再按扩展名猜一次"这其实是文本"。
//
// 现在"是不是文本"由**字节**判定（后端 mime.rs 的 looks_like_text），这类文件
// 上传后 mime 就是 text/*，于是这份清单连同"other 类别里按扩展名认领文本"的规则
// 一起退休了。**别再往前端加这类表** —— 后端判得出就是判得出。

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

/** 是否是电子书（注册表按扩展名认领；内容判据在后端 —— epub 也是 zip） */
export function isEpubName(name: string): boolean {
	return /\.epub$/i.test(name.trim());
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
