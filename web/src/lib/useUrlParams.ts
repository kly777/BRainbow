/**
 * useUrlParams — 类型化 URL 查询参数读写（基于 @solidjs/router 的 useSearchParams）。
 *
 * 每个参数用「描述器」声明如何解析（raw string → T）与序列化（T → raw string | undefined）：
 * - write 返回 undefined 表示从 URL 移除该参数
 * - 默认值一律不写入 URL（写回默认值即清除）
 *
 * 用法：
 * ```ts
 * const params = useUrlParams({
 *   q: strParam(""),
 *   page: numParam(1),
 *   view: enumParam(["list", "kanban"] as const, "list"),
 *   tags: listParam(),
 * });
 * params.get("page");        // number
 * params.set({ q: "x", page: 1 });  // page 是默认值 → 自动从 URL 清除
 * params.set({ tags: ["a"] });      // "tags=a"
 * ```
 */
import { useSearchParams } from "@solidjs/router";

export interface UrlParamReader<T> {
	/** 从 URL 原始字符串解析（参数缺失时为 undefined） */
	read: (raw: string | undefined) => T;
	/** 序列化为 URL 字符串；返回 undefined 表示不写入/移除 */
	write: (value: T) => string | undefined;
}

// ── 内置描述器 ──

/** 字符串参数，默认 "" 不写入 URL */
export function strParam(def = ""): UrlParamReader<string> {
	return {
		read: (raw) => (typeof raw === "string" ? raw : def),
		write: (v) => (v === def ? undefined : v),
	};
}

/** 数字参数：非法/缺失回退默认值；非负整数语义（<=0 回退） */
export function numParam(def: number, opts: { min?: number; integer?: boolean } = {}): UrlParamReader<number> {
	const { min = 0, integer = true } = opts;
	return {
		read: (raw) => {
			if (typeof raw !== "string" || raw === "") return def;
			const n = Number(raw);
			if (Number.isNaN(n)) return def;
			if (integer && !Number.isInteger(n)) return def;
			return n < min ? def : n;
		},
		write: (v) => (v === def ? undefined : String(v)),
	};
}

/** 逗号分隔列表参数（如 "a,b,c" → ["a","b","c"]） */
export function listParam(sep = ","): UrlParamReader<string[]> {
	return {
		read: (raw) => (typeof raw === "string" ? raw.split(sep).filter(Boolean) : []),
		write: (vs) => (vs.length === 0 ? undefined : vs.join(sep)),
	};
}

/** 枚举参数：不在白名单内回退默认值 */
export function enumParam<T extends string>(
	valid: readonly T[],
	def: T,
): UrlParamReader<T> {
	return {
		read: (raw) =>
			typeof raw === "string" && (valid as readonly string[]).includes(raw)
				? (raw as T)
				: def,
		write: (v) => (v === def ? undefined : v),
	};
}

/** 布尔参数（"1"/"true" → true） */
export function boolParam(def = false): UrlParamReader<boolean> {
	return {
		read: (raw) => {
			if (typeof raw !== "string") return def;
			return raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : def;
		},
		write: (v) => (v === def ? undefined : v ? "1" : "0"),
	};
}

// ── 类型工具 ──

// 约束用 unknown 兜底（仅作 extends 边界，ParamsOf 仍精确推导）；
// 不用 UrlParamReader<unknown> 作为键类型：write 参数逆变会使字面量描述器不满足约束
export type UrlParamMap = Record<string, UrlParamReader<unknown>>;
// biome-ignore lint/suspicious/noExplicitAny: 约束兜底，索引访问时由 ParamsOf 收窄
type AnyReader = UrlParamReader<any>;

/** 从描述器映射推导参数值类型（映射类型保留字面量精度） */
export type ParamsOf<T extends UrlParamMap> = {
	[K in keyof T]: T[K] extends UrlParamReader<infer V> ? V : never;
};

export interface UseUrlParamsResult<T extends UrlParamMap> {
	/** 读取参数（响应式：每次调用读当前 URL 值） */
	get: <K extends keyof T>(key: K) => ParamsOf<T>[K];
	/** 批量写入；显式 undefined 或默认值均从 URL 移除。opts.replace 用 history.replaceState */
	set: (patch: Partial<ParamsOf<T>>, opts?: { replace?: boolean }) => void;
	/** 底层 setSearchParams（罕见需求直通） */
	setSearchParams: (params: Record<string, string | undefined>) => void;
}

export function useUrlParams<const T extends Record<string, AnyReader>>(readers: T): UseUrlParamsResult<T> {
	const [searchParams, setSearchParams] = useSearchParams();

	const get = <K extends keyof T>(key: K): ParamsOf<T>[K] =>
		readers[key].read(searchParams[key] as string | undefined) as ParamsOf<T>[K];

	const set = (patch: Partial<ParamsOf<T>>, opts?: { replace?: boolean }) => {
		const next: Record<string, string | undefined> = {};
		for (const [key, value] of Object.entries(patch)) {
			next[key] = value === undefined ? undefined : readers[key].write(value as never);
		}
		if (opts?.replace) setSearchParams(next, { replace: true });
		else setSearchParams(next);
	};

	return { get, set, setSearchParams };
}
