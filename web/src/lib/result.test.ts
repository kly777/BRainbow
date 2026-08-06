/**
 * Result 类型单元测试
 */
import { describe, expect, it } from "vitest";
import {
	ok,
	err,
	isOk,
	isErr,
	map,
	flatMap,
	mapErr,
	unwrapOr,
	unwrapOrNull,
	match,
	tap,
	tapErr,
	tryAsync,
	trySync,

} from "./result.ts";

describe("Result 构造器", () => {
	it("ok() 创建成功值", () => {
		const r = ok(42);
		expect(r.ok).toBe(true);
		expect(r.value).toBe(42);
	});

	it("err() 创建失败值", () => {
		const r = err("something wrong");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("something wrong");
	});
});

describe("类型守卫", () => {
	it("isOk 对 Ok 返回 true", () => {
		expect(isOk(ok(1))).toBe(true);
	});

	it("isOk 对 Err 返回 false", () => {
		expect(isOk(err("x"))).toBe(false);
	});

	it("isErr 对 Err 返回 true", () => {
		expect(isErr(err("x"))).toBe(true);
	});

	it("isErr 对 Ok 返回 false", () => {
		expect(isErr(ok(1))).toBe(false);
	});
});

describe("map", () => {
	it("对 Ok 应用变换", () => {
		const r = map(ok(5), (x) => x * 2);
		expect(r.ok && r.value).toBe(10);
	});

	it("Err 原样传递", () => {
		const e = err("fail");
		const r = map(e, (x: number) => x * 2);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("fail");
	});
});

describe("flatMap", () => {
	it("Ok → Ok 链式", () => {
		const r = flatMap(ok(5), (x) => ok(x * 2));
		expect(r.ok && r.value).toBe(10);
	});

	it("Ok → Err 短路", () => {
		const r = flatMap(ok(5), () => err("short"));
		expect(r.ok).toBe(false);
	});

	it("Err 跳过 fn", () => {
		const fn = () => {
			throw new Error("should not be called");
		};
		const r = flatMap<number, number, string>(err("x"), fn);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("x");
	});
});

describe("mapErr", () => {
	it("变换错误类型", () => {
		const r = mapErr(err("raw"), (e) => `wrapped: ${e}`);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("wrapped: raw");
	});

	it("Ok 原样传递", () => {
		const r = mapErr(ok(1), (e) => `wrapped: ${e}`);
		expect(r.ok && r.value).toBe(1);
	});
});

describe("unwrapOr", () => {
	it("Ok 提取值", () => {
		expect(unwrapOr(ok(42), 0)).toBe(42);
	});

	it("Err 返回默认值", () => {
		expect(unwrapOr(err("x"), 0)).toBe(0);
	});
});

describe("unwrapOrNull", () => {
	it("Ok → 值", () => {
		expect(unwrapOrNull(ok(42))).toBe(42);
	});

	it("Err → null", () => {
		expect(unwrapOrNull(err("x"))).toBeNull();
	});
});

describe("match", () => {
	it("匹配 Ok 分支", () => {
		const msg = match(ok("Alice"), {
			ok: (name) => `Hello ${name}`,
			err: (e) => `Error: ${e}`,
		});
		expect(msg).toBe("Hello Alice");
	});

	it("匹配 Err 分支", () => {
		const msg = match(err("timeout"), {
			ok: (name: string) => `Hello ${name}`,
			err: (e) => `Error: ${e}`,
		});
		expect(msg).toBe("Error: timeout");
	});
});

describe("tap / tapErr", () => {
	it("tap 对 Ok 执行副作用", () => {
		const side: number[] = [];
		const r = tap(ok(5), (x) => side.push(x));
		expect(side).toEqual([5]);
		expect(r.ok && r.value).toBe(5);
	});

	it("tap 对 Err 不执行", () => {
		const side: number[] = [];
		tap(err("x"), () => side.push(1));
		expect(side).toEqual([]);
	});

	it("tapErr 对 Err 执行副作用", () => {
		const side: string[] = [];
		tapErr(err("oops"), (e) => side.push(e));
		expect(side).toEqual(["oops"]);
	});
});

describe("tryAsync", () => {
	it("成功 → Ok", async () => {
		const r = await tryAsync(() => Promise.resolve(42));
		expect(r.ok && r.value).toBe(42);
	});

	it("抛出异常 → Err", async () => {
		const r = await tryAsync(() => {
			throw new Error("boom");
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toBe("boom");
	});

	it("抛出非 Error → 包装为 Error", async () => {
		const r = await tryAsync(() => {
			throw "raw string";
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBeInstanceOf(Error);
	});
});

describe("trySync", () => {
	it("成功 → Ok", () => {
		const r = trySync(() => 42);
		expect(r.ok && r.value).toBe(42);
	});

	it("抛出 → Err", () => {
		const r = trySync(() => {
			throw new Error("sync boom");
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toBe("sync boom");
	});
});
