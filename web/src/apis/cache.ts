/**
 * Stale-While-Revalidate 缓存
 *
 * 用法：
 *   const resource = createSWR("tasks", () => getTasks());
 *   <Show when={resource.data()} fallback={<Loading />}>
 *     {(data) => <div>{data}</div>}
 *   </Show>
 *
 * 行为：
 *   - 有缓存 → 立即返回缓存 → 后台 fetch → 替换
 *   - 无缓存 → 返回 undefined（loading=true）→ fetch → 更新
 */

import { createSignal, onCleanup } from "solid-js";
import { Effect } from "effect";
import type { ApiErrorType } from "./types/index.ts";

const store = new Map<string, unknown>();

export function getCache<T>(key: string): T | undefined {
    return store.get(key) as T | undefined;
}

export function setCache(key: string, data: unknown): void {
    store.set(key, data);
}

export function clearCache(key?: string): void {
    if (key) store.delete(key);
    else store.clear();
}

export interface SWR<T> {
    data: () => T | undefined;
    loading: () => boolean;
    error: () => string | null;
    refetch: () => void;
}

export function createSWR<T>(
    key: string,
    fetcher: () => Effect.Effect<T, ApiErrorType>,
): SWR<T> {
    const cached = getCache<T>(key);
    const [data, setData] = createSignal<T | undefined>(cached);
    const [loading, setLoading] = createSignal(!cached);
    const [error, setError] = createSignal<string | null>(null);

    let cancelled = false;

    const fetch = async () => {
        setLoading(true);
        setError(null);

        const exit = await Effect.runPromiseExit(fetcher());
        if (cancelled) return;

        if (exit._tag === "Success") {
            const value = exit.value as T;
            setCache(key, value);
            setData(() => value);
        } else {
            setError(String(exit.cause));
        }
        setLoading(false);
    };

    fetch();
    onCleanup(() => { cancelled = true; });

    return {
        data,
        loading,
        error,
        refetch: () => {
            store.delete(key);
            fetch();
        },
    };
}
