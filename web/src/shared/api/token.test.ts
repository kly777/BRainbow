// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	API_KEY_STORAGE_KEY,
	clearUser,
	getApiKey,
	getToken,
	STORAGE_KEY,
	saveUser,
	setApiKey,
} from "./token.ts";

beforeEach(() => {
	localStorage.clear();
	clearUser();
	setApiKey(null);
});

describe("token storage", () => {
	it("saveUser 后 getToken 可读取 token", () => {
		saveUser({ id: 1, name: "qa", role: "admin", token: "jwt-1" });
		expect(getToken()).toBe("jwt-1");
	});

	it("getToken 使用内存缓存：外部直接改 localStorage 不会影响已缓存值", () => {
		saveUser({ id: 1, name: "qa", role: "admin", token: "jwt-1" });
		expect(getToken()).toBe("jwt-1");
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ id: 1, name: "qa", role: "admin", token: "jwt-2" }),
		);
		expect(getToken()).toBe("jwt-1");
	});

	it("clearUser 清空 token 并同步清缓存", () => {
		saveUser({ id: 1, name: "qa", role: "admin", token: "jwt-1" });
		clearUser();
		expect(getToken()).toBeNull();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("setApiKey / getApiKey 持久化并缓存", () => {
		setApiKey("key-1");
		expect(getApiKey()).toBe("key-1");
		localStorage.setItem(API_KEY_STORAGE_KEY, "key-2");
		expect(getApiKey()).toBe("key-1");
		setApiKey(null);
		expect(getApiKey()).toBeNull();
	});

	it("损坏的 JSON 视为无用户且不抛错", () => {
		localStorage.setItem(STORAGE_KEY, "{not-json");
		expect(getToken()).toBeNull();
	});
});
