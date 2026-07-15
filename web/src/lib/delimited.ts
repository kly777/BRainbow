/**
 * 分隔符文本解析（CSV / PSV）。
 *
 * 提供两个核心函数：
 * - `parseDelimitedText(text, delim)` — 逐字符解析，支持引号包裹的换行
 * - `detectDelimiter(text)` — 自动检测分隔符（`|` vs `,`）
 *
 * 以及一个便捷函数：
 * - `parseImportFile(text, filename)` — 根据文件类型自动分发（JSON / CSV / PSV）
 */

// ── 导出类型 ──

/** 导入预览行 */
export interface ImportRow {
	cue: string;
	target: string;
	tags: string[];
}

// ── 核心解析 ──

/**
 * 按引用状态逐字符解 CSV/PSV，返回二维数组。
 *
 * 特性：
 * - 支持引号包裹的换行内容
 * - 支持 `""` 转义
 * - 支持 `\r\n` / `\n` / `\r` 三种行尾
 * - 自动跳过空白行
 *
 * @param text  原始文本内容
 * @param delim 列分隔符（`","` 或 `"|"` 等）
 * @returns      二维字符串数组，每行一个数组
 *
 * @example
 * ```ts
 * parseDelimitedText("a|b|c\n1|2|3", "|")
 * // → [["a", "b", "c"], ["1", "2", "3"]]
 *
 * parseDelimitedText('"multi\nline"|b|c', "|")
 * // → [["multi\nline", "b", "c"]]
 * ```
 */
export function parseDelimitedText(text: string, delim: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuote = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];

		if (ch === '"') {
			if (inQuote && next === '"') {
				field += '"';
				i++; // 跳过转义的 ""
			} else {
				inQuote = !inQuote;
			}
			continue;
		}

		// 列分隔符（仅非引号内）
		if (ch === delim && !inQuote) {
			row.push(field.trim());
			field = "";
			continue;
		}

		// 行分隔符（仅非引号内）
		if ((ch === "\n" || (ch === "\r" && next === "\n")) && !inQuote) {
			if (ch === "\r") i++; // 跳过 \r 只留 \n
			row.push(field.trim());
			field = "";
			if (row.some((f) => f.length > 0)) rows.push(row);
			row = [];
			continue;
		}
		if (ch === "\r" && !inQuote) {
			// 独立 \r（旧 Mac 风格）
			row.push(field.trim());
			field = "";
			if (row.some((f) => f.length > 0)) rows.push(row);
			row = [];
			continue;
		}

		field += ch;
	}

	// 最后一条记录
	row.push(field.trim());
	if (row.some((f) => f.length > 0)) rows.push(row);

	return rows;
}

/**
 * 自动检测分隔符：比较 `|` 和 `,` 在全文非引号区域的出现次数，
 * 多的那个被选为分隔符（平票时选 `,` 保持兼容）。
 *
 * @param text 原始文本内容
 * @returns `"|"` 或 `","`
 *
 * @example
 * ```ts
 * detectDelimiter("a|b|c\n1|2|3")  // → "|"
 * detectDelimiter("a,b,c\n1,2,3")  // → ","
 * detectDelimiter("a,b|c")         // → "|" (pipe 更多)
 * ```
 */
export function detectDelimiter(text: string): string {
	let pipe = 0;
	let comma = 0;
	let inQuote = false;

	for (const ch of text) {
		if (ch === '"') {
			inQuote = !inQuote;
			continue;
		}
		if (inQuote) continue;
		if (ch === "|") pipe++;
		if (ch === ",") comma++;
	}

	return pipe > comma ? "|" : ",";
}

/**
 * 按行拆分为 cue|target|tags 格式（批量文本输入用）。
 * 支持 `|` 或 `\t` 作分隔符。
 *
 * @example
 * ```ts
 * parseBatch("质能方程 | E=mc²\n光速\t299792458")
 * // → [{ cue: "质能方程", target: "E=mc²" }, { cue: "光速", target: "299792458" }]
 * ```
 */
export function parseBatch(text: string): { cue: string; target: string }[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const sep = line.includes("|") ? "|" : "\t";
			const [cue = "", target = ""] = line.split(sep, 2);
			return { cue: cue.trim(), target: target.trim() };
		})
		.filter((p) => p.cue && p.target);
}

/**
 * 从导入文件中解析预览行。
 *
 * 根据文件名后缀自动分发：
 * - `.json` → 解析 JSON 数组或 `{ mems: [...] }`
 * - 其他（`.csv` / `.psv`）→ 自动检测分隔符 + 按行解析
 *
 * @param text     文件文本内容
 * @param filename 文件名（用于判断格式）
 * @returns        预览行数组
 *
 * @example
 * ```ts
 * await parseImportFile('{"cue":"a","target":"b"}', "data.json")
 * // → [{ cue: "a", target: "b", tags: [], selected: true }]
 * ```
 */
export function parseImportFile(text: string, filename: string): ImportRow[] {
	// JSON 文件
	if (filename.toLowerCase().endsWith(".json")) {
		const json = JSON.parse(text);
		const items = Array.isArray(json) ? json : (json.mems ?? []);
		return items.map(
			(i: { cue?: string; target?: string; tags?: string[] }) => ({
				cue: (i.cue ?? "").trim(),
				target: (i.target ?? "").trim(),
				tags: i.tags ?? [],
			}),
		);
	}

	// CSV / PSV
	const delim = detectDelimiter(text);
	const rows = parseDelimitedText(text, delim);
	if (rows.length === 0) return [];

	// 跳过表头
	const hasHeader =
		rows[0][0]?.toLowerCase().includes("cue") ||
		rows[0][0]?.toLowerCase().includes("target");
	const dataRows = hasHeader ? rows.slice(1) : rows;

	return dataRows
		.map((fields) => {
			const cue = (fields[0] ?? "").trim();
			const target = (fields[1] ?? "").trim();
			const tags = (fields[2] ?? "")
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter(Boolean);
			return { cue, target, tags };
		})
		.filter((r) => r.cue && r.target);
}
