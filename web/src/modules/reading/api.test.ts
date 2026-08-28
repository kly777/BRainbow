import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getArticle,
	getArticleNotes,
	getArticleWords,
	listArticles,
	listUnknownWords,
	markWord,
	recommendNext,
	updateArticleNotes,
	uploadArticle,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
}));

describe("reading API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取文章列表", async () => {
		// 测试获取文章列表
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockArticles = {
			articles: [
				{
					id: 1,
					title: "测试文章",
					word_count: 100,
					known_ratio: 0.8,
					unknown_word_count: 20,
					created_at: "2024-01-01",
				},
			],
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockArticles);

		// 调用获取文章列表API
		const result = await listArticles();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/reading", {});

		// 验证返回结果
		expect(result).toEqual(mockArticles);
	});

	it("获取文章详情", async () => {
		// 测试获取文章详情
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockArticle = {
			article: {
				id: 1,
				title: "测试文章",
				content: "文章内容",
				word_count: 100,
				notes: "",
				created_at: "2024-01-01",
			},
			words: [
				{ word: "测试", status: "unknown" },
				{ word: "文章", status: "known" },
			],
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockArticle);

		// 调用获取文章详情API
		const result = await getArticle(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/reading/1", {});

		// 验证返回结果
		expect(result).toEqual(mockArticle);
	});

	it("上传文章", async () => {
		// 测试上传文章
		const { post } = await import("@shared/api");
		const mockPost = vi.mocked(post);

		const mockResult = {
			article: {
				id: 2,
				title: "新文章",
				content: "新内容",
				word_count: 50,
				notes: "",
				created_at: "2024-01-02",
			},
		};

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockResult);

		// 调用上传文章API
		const result = await uploadArticle("新文章", "新内容");

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/reading", {
			title: "新文章",
			content: "新内容",
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("标记单词状态", async () => {
		// 测试标记单词状态
		const { post } = await import("@shared/api");
		const mockPost = vi.mocked(post);

		const mockResult = { ok: true };

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockResult);

		// 调用标记单词状态API
		const result = await markWord("测试", "known");

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/reading/word/%E6%B5%8B%E8%AF%95", {
			status: "known",
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("获取未知单词列表", async () => {
		// 测试获取未知单词列表
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockWords = {
			words: [
				{
					word: "测试",
					unknown_count: 5,
					known_count: 2,
					first_seen_at: "2024-01-01",
				},
			],
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockWords);

		// 调用获取未知单词列表API
		const result = await listUnknownWords();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/reading/unknown", {});

		// 验证返回结果
		expect(result).toEqual(mockWords);
	});

	it("推荐下一篇文章", async () => {
		// 测试推荐下一篇文章
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockRecommendation = {
			recommended: {
				id: 2,
				title: "推荐文章",
				word_count: 80,
				known_ratio: 0.7,
				unknown_word_count: 24,
				created_at: "2024-01-02",
			},
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockRecommendation);

		// 调用推荐下一篇文章API
		const result = await recommendNext(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/reading/1/recommend", {});

		// 验证返回结果
		expect(result).toEqual(mockRecommendation);
	});

	it("获取和更新文章笔记", async () => {
		// 测试获取和更新文章笔记
		const { request, put } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockPut = vi.mocked(put);

		const mockNotes = { notes: "测试笔记" };
		const mockUpdateResult = { ok: true };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockNotes);
		mockPut.mockResolvedValueOnce(mockUpdateResult);

		// 调用获取文章笔记API
		const notesResult = await getArticleNotes(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/reading/1/notes", {});

		// 验证返回结果
		expect(notesResult).toEqual(mockNotes);

		// 调用更新文章笔记API
		const updateResult = await updateArticleNotes(1, "新笔记");

		// 验证put被调用
		expect(mockPut).toHaveBeenCalledTimes(1);
		expect(mockPut).toHaveBeenCalledWith("/reading/1/notes", {
			notes: "新笔记",
		});

		// 验证返回结果
		expect(updateResult).toEqual(mockUpdateResult);
	});
});
