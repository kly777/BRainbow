/**
 * Result 类型 —— Railway Oriented Programming
 *
 * 用类型安全的 Ok / Err 联合类型替代 try/catch，
 * 让错误处理变成显式的、可组合的数据流。
 *
 * 用法：
 *   import { ok, err, tryAsync, type Result } from "./result";
 *
 *   const result = await tryAsync(() => deleteCard(id));
 *   if (result.ok) {
 *     navigate("/c");
 *   } else {
 *     notifyError("删除失败", result.error);
 *   }
 *
 *   // 链式处理
 *   const message = pipe(
 *     tryAsync(() => fetchUser(id)),
 *     map(user => user.name),
 *     unwrapOr("未知用户"),
 *   );
 */

// ==================== 类型定义 ====================

/** 成功值 */
export interface Ok<T> {
	readonly ok: true;
	readonly value: T;
}

/** 失败值 */
export interface Err<E> {
	readonly ok: false;
	readonly error: E;
}

/** Result 联合类型 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

// ==================== 构造器 ====================

/** 构造成功 Result */
export function ok<T>(value: T): Ok<T> {
	return { ok: true, value };
}

/** 构造失败 Result */
export function err<E>(error: E): Err<E> {
	return { ok: false, error };
}

// ==================== 类型守卫 ====================

/** 是否为 Ok */
export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
	return r.ok;
}

/** 是否为 Err */
export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
	return !r.ok;
}

// ==================== 变换 ====================

/**
 * 对 Ok 值应用 fn，Err 原样传递。
 *
 * @example
 *   map(ok(5), x => x * 2)  // Ok(10)
 *   map(err("fail"), x => x * 2)  // Err("fail")
 */
export function map<T, U, E>(
	r: Result<T, E>,
	fn: (value: T) => U,
): Result<U, E> {
	return r.ok ? ok(fn(r.value)) : r;
}

/**
 * 对 Ok 值应用可能失败的 fn，Err 原样传递。
 * 这是 Railway Oriented Programming 的核心操作。
 *
 * @example
 *   flatMap(ok(user), u => u.active ? ok(u) : err("inactive"))
 */
export function flatMap<T, U, E>(
	r: Result<T, E>,
	fn: (value: T) => Result<U, E>,
): Result<U, E> {
	return r.ok ? fn(r.value) : r;
}

/**
 * 对 Err 的错误类型做变换，Ok 原样传递。
 */
export function mapErr<T, E, F>(
	r: Result<T, E>,
	fn: (error: E) => F,
): Result<T, F> {
	return r.ok ? r : err(fn(r.error));
}

// ==================== 提取 ====================

/**
 * 安全提取值，提供默认值。
 *
 * @example
 *   unwrapOr(ok(5), 0)     // 5
 *   unwrapOr(err("x"), 0)  // 0
 */
export function unwrapOr<T, E>(r: Result<T, E>, defaultValue: T): T {
	return r.ok ? r.value : defaultValue;
}

/**
 * 尝试提取值，不存在则返回 null。
 */
export function unwrapOrNull<T, E>(r: Result<T, E>): T | null {
	return r.ok ? r.value : null;
}

// ==================== 模式匹配 ====================

/**
 * 穷举模式匹配 —— 同时处理 Ok 和 Err 两个分支。
 *
 * @example
 *   const msg = match(result, {
 *     ok: (user) => `你好 ${user.name}`,
 *     err: (error) => `加载失败: ${error.message}`,
 *   });
 */
export function match<T, E, R>(
	r: Result<T, E>,
	cases: {
		ok: (value: T) => R;
		err: (error: E) => R;
	},
): R {
	return r.ok ? cases.ok(r.value) : cases.err(r.error);
}

// ==================== 副作用 ====================

/**
 * 对 Ok 值执行副作用操作，返回原 Result。
 * 适合插入日志、toast 等不影响数据流的操作。
 *
 * @example
 *   tap(ok(user), u => console.log("loaded:", u.name))
 */
export function tap<T, E>(r: Result<T, E>, fn: (value: T) => void): Result<T, E> {
	if (r.ok) fn(r.value);
	return r;
}

/**
 * 对 Err 值执行副作用操作，返回原 Result。
 */
export function tapErr<T, E>(
	r: Result<T, E>,
	fn: (error: E) => void,
): Result<T, E> {
	if (!r.ok) fn(r.error);
	return r;
}

// ==================== 异步包装 ====================

/**
 * 安全执行异步函数，永不抛出异常，返回 Result。
 *
 * 这是替代 try/catch 的核心工具：
 *
 * @example
 *   // 之前：
 *   try {
 *     const user = await fetchUser(id);
 *     // 用 user 做后续操作...
 *   } catch (e) {
 *     notifyError("加载失败", e);
 *   }
 *
 *   // 之后：
 *   const result = await tryAsync(() => fetchUser(id));
 *   if (!result.ok) {
 *     notifyError("加载失败", result.error);
 *     return;
 *   }
 *   const user = result.value;
 *
 * @param fn - 可能抛出异常的异步函数
 * @returns Ok(data) 或 Err(error)。error 保证是 Error 类型。
 */
export async function tryAsync<T>(
	fn: () => Promise<T>,
): Promise<Result<T, Error>> {
	try {
		const value = await fn();
		return ok(value);
	} catch (e: unknown) {
		const error = e instanceof Error ? e : new Error(String(e));
		return err(error);
	}
}

/**
 * 安全执行同步函数，永不抛出，返回 Result。
 */
export function trySync<T>(fn: () => T): Result<T, Error> {
	try {
		return ok(fn());
	} catch (e: unknown) {
		const error = e instanceof Error ? e : new Error(String(e));
		return err(error);
	}
}
