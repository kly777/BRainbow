import { describe, expect, it } from "vitest";
import { codeFence, codeLang, fileExt, isTextLike } from "./filename.ts";

describe("fileExt", () => {
	it("提取常见后缀并大写", () => {
		expect(fileExt("report.pdf")).toBe("PDF");
		expect(fileExt("photo.PNG")).toBe("PNG");
		expect(fileExt("表格.xlsx")).toBe("XLSX");
	});

	it("多点文件名取最后一段", () => {
		expect(fileExt("archive.tar.gz")).toBe("GZ");
		expect(fileExt("my.file.name.md")).toBe("MD");
	});

	it("无后缀返回空串", () => {
		expect(fileExt("README")).toBe("");
		expect(fileExt(".gitignore")).toBe(""); // 隐藏文件不算后缀
		expect(fileExt("trailing.")).toBe("");
		expect(fileExt("")).toBe("");
	});

	it("超长后缀截断到 5 字符", () => {
		expect(fileExt("data.jpeg2000")).toBe("JPEG2");
	});
});

describe("isTextLike", () => {
	it("识别代码与配置后缀", () => {
		for (const name of [
			"main.rs",
			"script.py",
			"app.ts",
			"config.yaml",
			"data.json",
			"schema.sql",
			"run.sh",
			"Cargo.toml",
			"notes.log",
			"query.sql",
		]) {
			expect(isTextLike(name), name).toBe(true);
		}
	});

	it("识别无扩展名的常见文本文件", () => {
		for (const name of [
			"Dockerfile",
			"Makefile",
			"LICENSE",
			"README",
			".gitignore",
			".env",
		]) {
			expect(isTextLike(name), name).toBe(true);
		}
	});

	it("二进制与未知类型不按文本预览", () => {
		for (const name of [
			"model.ply",
			"photo.png",
			"video.mp4",
			"archive.zip",
			"doc.pdf",
			"font.ttf",
		]) {
			expect(isTextLike(name), name).toBe(false);
		}
	});

	it("大小写不敏感", () => {
		expect(isTextLike("MAIN.RS")).toBe(true);
		expect(isTextLike("dockerfile")).toBe(true);
	});
});

describe("codeLang", () => {
	it("映射到 highlight.js 语言名", () => {
		expect(codeLang("main.rs")).toBe("rust");
		expect(codeLang("app.tsx")).toBe("typescript");
		expect(codeLang("config.yml")).toBe("yaml");
		expect(codeLang("Dockerfile")).toBe("dockerfile");
	});

	it("无高亮语言返回空串（仍按纯文本预览）", () => {
		expect(codeLang("Cargo.toml")).toBe("");
		expect(codeLang("notes.log")).toBe("");
		expect(codeLang("model.ply")).toBe("");
	});
});

describe("codeFence", () => {
	it("普通内容用三反引号围栏", () => {
		expect(codeFence("let a = 1;", "rust")).toBe("```rust\nlet a = 1;\n```");
	});

	it("内容含反引号时围栏加长，避免提前闭合", () => {
		const fenced = codeFence("```\ninner\n```", "markdown");
		expect(fenced.startsWith("````markdown")).toBe(true);
		expect(fenced.endsWith("````")).toBe(true);
	});
});
