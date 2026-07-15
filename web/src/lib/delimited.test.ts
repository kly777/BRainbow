import { describe, expect, it } from "vitest";
import {
	detectDelimiter,
	parseBatch,
	parseDelimitedText,
	parseImportFile,
} from "./delimited.ts";

// ── parseDelimitedText ──

describe("parseDelimitedText", () => {
	it("parses simple PSV rows", () => {
		const result = parseDelimitedText("a|b|c\n1|2|3", "|");
		expect(result).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("parses simple CSV rows", () => {
		const result = parseDelimitedText("a,b,c\n1,2,3", ",");
		expect(result).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("handles quoted field with newline", () => {
		const result = parseDelimitedText('"multi\nline"|b|c', "|");
		expect(result).toEqual([["multi\nline", "b", "c"]]);
	});

	it("handles quoted field with escaped quotes", () => {
		// "say ""hello""" = say "hello"
		// 开头 ": 开始引用；""→"；""→"；结尾 ": 关闭引用
		const result = parseDelimitedText('"say ""hello"""|b', "|");
		expect(result).toEqual([['say "hello"', "b"]]);
	});

	it("handles trailing escaped quote before delimiter", () => {
		// "value"""|next → value"  ("" 是转义引号，最后的 " 关闭引用)
		const result = parseDelimitedText('"value"""|next', "|");
		expect(result).toEqual([['value"', "next"]]);
	});

	it("skips empty lines", () => {
		const result = parseDelimitedText("a|b|c\n\n\n1|2|3", "|");
		expect(result).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("handles \\r\\n line endings", () => {
		const result = parseDelimitedText("a|b|c\r\n1|2|3", "|");
		expect(result).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("handles standalone \\r line endings (old Mac)", () => {
		const result = parseDelimitedText("a|b|c\r1|2|3", "|");
		expect(result).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("trims field whitespace", () => {
		const result = parseDelimitedText("  a  |  b  |  c  ", "|");
		expect(result).toEqual([["a", "b", "c"]]);
	});

	it("does not split delimiter inside quotes", () => {
		const result = parseDelimitedText('"a,b"|c|d', "|");
		expect(result).toEqual([["a,b", "c", "d"]]);
	});

	it("handles empty fields", () => {
		const result = parseDelimitedText("a||c", "|");
		expect(result).toEqual([["a", "", "c"]]);
	});

	it("handles trailing newline gracefully", () => {
		const result = parseDelimitedText("a|b|c\n", "|");
		expect(result).toEqual([["a", "b", "c"]]);
	});

	it("returns empty array for empty input", () => {
		const result = parseDelimitedText("", "|");
		expect(result).toEqual([]);
	});

	it("returns empty array for whitespace-only input", () => {
		const result = parseDelimitedText("   \n  \n  ", "|");
		expect(result).toEqual([]);
	});
});

// ── detectDelimiter ──

describe("detectDelimiter", () => {
	it("detects pipe when more pipes than commas", () => {
		expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
	});

	it("detects comma when more commas than pipes", () => {
		expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
	});

	it("defaults to comma on tie", () => {
		expect(detectDelimiter("a|b,c")).toBe(",");
	});

	it("ignores delimiters inside quotes", () => {
		expect(detectDelimiter('"a,b"|c|d')).toBe("|");
	});

	it("detects pipe for single-row PSV", () => {
		expect(detectDelimiter("质能方程|E=mc²|物理")).toBe("|");
	});
});

// ── parseBatch ──

describe("parseBatch", () => {
	it("parses pipe-separated batch input", () => {
		const result = parseBatch("质能方程 | E=mc²\n光速 | 299792458");
		expect(result).toEqual([
			{ cue: "质能方程", target: "E=mc²" },
			{ cue: "光速", target: "299792458" },
		]);
	});

	it("parses tab-separated batch input", () => {
		const result = parseBatch("质能方程\tE=mc²\n光速\t299792458");
		expect(result).toEqual([
			{ cue: "质能方程", target: "E=mc²" },
			{ cue: "光速", target: "299792458" },
		]);
	});

	it("skips empty lines and lines with missing fields", () => {
		const result = parseBatch("a|b\n\n\nc|d\n|nothing");
		expect(result).toEqual([
			{ cue: "a", target: "b" },
			{ cue: "c", target: "d" },
		]);
	});

	it("returns empty array for empty input", () => {
		expect(parseBatch("")).toEqual([]);
	});

	it("trims whitespace from fields", () => {
		const result = parseBatch("  a  |  b  ");
		expect(result).toEqual([{ cue: "a", target: "b" }]);
	});
});

// ── parseImportFile ──

describe("parseImportFile", () => {
	// ── JSON ──

	it("parses JSON array", () => {
		const result = parseImportFile(
			'[{"cue":"a","target":"b","tags":["t1"]},{"cue":"c","target":"d"}]',
			"data.json",
		);
		expect(result).toEqual([
			{ cue: "a", target: "b", tags: ["t1"] },
			{ cue: "c", target: "d", tags: [] },
		]);
	});

	it("parses JSON with mems wrapper", () => {
		const result = parseImportFile(
			'{"mems":[{"cue":"a","target":"b"}]}',
			"data.json",
		);
		expect(result).toEqual([{ cue: "a", target: "b", tags: [] }]);
	});

	it("trims JSON cue/target", () => {
		const result = parseImportFile(
			'[{"cue":"  a  ","target":"  b  "}]',
			"import.json",
		);
		expect(result).toEqual([{ cue: "a", target: "b", tags: [] }]);
	});

	// ── PSV ──

	it("parses PSV with header", () => {
		const result = parseImportFile(
			"cue|target|tags\na|b|t1;t2\nc|d|t3",
			"data.psv",
		);
		expect(result).toEqual([
			{ cue: "a", target: "b", tags: ["t1", "t2"] },
			{ cue: "c", target: "d", tags: ["t3"] },
		]);
	});

	it("parses PSV without header", () => {
		const result = parseImportFile("a|b|t1;t2\nc|d", "data.psv");
		expect(result).toEqual([
			{ cue: "a", target: "b", tags: ["t1", "t2"] },
			{ cue: "c", target: "d", tags: [] },
		]);
	});

	it("parses PSV with multi-line field", () => {
		const text = 'cue|target|tags\n"multi\nline"|answer|tag';
		const result = parseImportFile(text, "data.psv");
		expect(result).toEqual([
			{ cue: "multi\nline", target: "answer", tags: ["tag"] },
		]);
	});

	// ── CSV ──

	it("parses CSV with header", () => {
		const result = parseImportFile(
			"cue,target,tags\na,b,t1;t2\nc,d,t3",
			"data.csv",
		);
		expect(result).toEqual([
			{ cue: "a", target: "b", tags: ["t1", "t2"] },
			{ cue: "c", target: "d", tags: ["t3"] },
		]);
	});

	it("parses CSV with quoted comma in field", () => {
		const result = parseImportFile('cue,target,tags\n"a,b",c,t1', "data.csv");
		expect(result).toEqual([{ cue: "a,b", target: "c", tags: ["t1"] }]);
	});

	it("filters out rows with empty cue or target", () => {
		const result = parseImportFile(
			"cue|target|tags\na|b|t1\n|d|t2\ne||t3",
			"data.psv",
		);
		expect(result).toEqual([{ cue: "a", target: "b", tags: ["t1"] }]);
	});

	it("returns empty array for empty CSV", () => {
		expect(parseImportFile("cue,target,tags\n", "data.csv")).toEqual([]);
	});

	it("handles tags separated by semicolons and commas", () => {
		const result = parseImportFile("cue|target|tags\na|b|t1,t2;t3", "data.psv");
		expect(result).toEqual([
			{ cue: "a", target: "b", tags: ["t1", "t2", "t3"] },
		]);
	});

	// ── 文件名大小写 ──

	it("handles uppercase .JSON extension", () => {
		const result = parseImportFile('[{"cue":"a","target":"b"}]', "DATA.JSON");
		expect(result).toEqual([{ cue: "a", target: "b", tags: [] }]);
	});

	it("handles .PSV extension", () => {
		const result = parseImportFile("cue|target|tags\na|b|t1", "export.PSV");
		expect(result).toEqual([{ cue: "a", target: "b", tags: ["t1"] }]);
	});
});
