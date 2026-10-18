// ── Mutation 生命周期：pending / error / 成功回调 / 失效 ──
//
// 业务模块不再各自写 `setPending(true) → tryAsync → setPending(false)`：
// 成功、失败、失效的顺序在这里统一。

import { tryAsync, type Result } from "@shared/utils/result.ts";
import { type Accessor, createSignal } from "solid-js";

export interface MutationOptions<TInput, TOutput> {
	run: (input: TInput) => Promise<TOutput>;
	onSuccess?: (value: TOutput, input: TInput) => void | Promise<void>;
	onError?: (error: unknown, input: TInput) => void;
	/** 成功后执行缓存失效；由调用方声明，不写死 domains */
	invalidate?: (value: TOutput, input: TInput) => void;
}

export interface Mutation<TInput, TOutput> {
	pending: Accessor<boolean>;
	error: Accessor<unknown>;
	run: (input: TInput) => Promise<Result<TOutput>>;
	reset: () => void;
}

export function useMutation<TInput, TOutput>(
	options: MutationOptions<TInput, TOutput>,
): Mutation<TInput, TOutput> {
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal<unknown>(null);

	const run = async (input: TInput): Promise<Result<TOutput>> => {
		setPending(true);
		setError(null);
		const result = await tryAsync(() => options.run(input));
		if (result.ok) {
			options.invalidate?.(result.value, input);
			await options.onSuccess?.(result.value, input);
		} else {
			setError(result.error);
			options.onError?.(result.error, input);
		}
		setPending(false);
		return result;
	};

	const reset = () => {
		setError(null);
		setPending(false);
	};

	return { pending, error, run, reset };
}
