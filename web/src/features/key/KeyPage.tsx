// ── API Key 管理页 ──
// dev 环境免登录可生成（后端 APP_ENV=dev）；prod 需登录（AuthGuard）。

import { getApiKey, useAuth } from "@app/auth/context.tsx";
import { del, get, post } from "@shared/api/request.ts";
import { getErrorMessage } from "@shared/api/types/errors.ts";
import { notifyError, notifySuccess } from "@shared/lib/notify.ts";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./KeyPage.module.css";

interface ApiKeyInfo {
	id: number;
	role: string;
	created_at: string;
	key?: string;
}

export default function KeyPage() {
	const { setApiKey } = useAuth();
	const [keys, { refetch }] = createResource(async () =>
		get<ApiKeyInfo[]>("/auth/keys"),
	);
	const [newKey, setNewKey] = createSignal<string | null>(null);
	const [generating, setGenerating] = createSignal(false);

	const activeKey = () => getApiKey();

	const handleGenerate = async () => {
		setGenerating(true);
		try {
			const info = await post<ApiKeyInfo>("/auth/key", {});
			setNewKey(info.key ?? null);
			refetch();
			notifySuccess("已生成 API key", "复制后保存，仅显示一次");
		} catch (e) {
			notifyError("生成 key 失败", e);
		} finally {
			setGenerating(false);
		}
	};

	const handleCopy = async (key: string) => {
		await navigator.clipboard.writeText(key);
		notifySuccess("已复制到剪贴板");
	};

	const handleApply = async (key: string) => {
		setApiKey(key);
		notifySuccess("已应用", "后续请求将携带此 key 认证");
	};

	const handleClear = () => {
		setApiKey(null);
		notifySuccess("已清除本地 key");
	};

	const handleDelete = async (id: number) => {
		try {
			await del(`/auth/key/${id}`);
			// 若删除的是当前应用的 key，同步清除本地
			refetch();
			notifySuccess("已删除");
		} catch (e) {
			notifyError("删除失败", e);
		}
	};

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>API Key</h1>
			<p class={styles.subtitle}>
				生成长期有效的 API key（仅登录后可操作）。key 永不过期，测试/脚本 请求带{" "}
				<code class={styles.inlineCode}>X-API-Key</code> 头即可认证，
				无需再登录。
			</p>

			{/* 生成 */}
			<div class={styles.card}>
				<h2 class={styles.cardTitle}>生成新 key</h2>
				<button
					type="button"
					class={styles.genBtn}
					onClick={handleGenerate}
					disabled={generating()}
				>
					{generating() ? "生成中…" : "＋ 生成"}
				</button>

				<Show when={newKey()}>
					{(k) => (
						<div class={styles.newKeyBox}>
							<div class={styles.newKeyLabel}>新 key（仅显示一次）：</div>
							<code class={styles.newKey}>{k()}</code>
							<div class={styles.actions}>
								<button
									type="button"
									class={styles.btn}
									onClick={() => handleCopy(k())}
								>
									复制
								</button>
								<button
									type="button"
									class={styles.btnPrimary}
									onClick={() => handleApply(k())}
								>
									应用此 key
								</button>
							</div>
						</div>
					)}
				</Show>
			</div>

			{/* 当前生效的 key */}
			<div class={styles.card}>
				<h2 class={styles.cardTitle}>当前生效的 key</h2>
				<Show
					when={activeKey()}
					fallback={<div class={styles.muted}>未设置——请求将要求登录。</div>}
				>
					{(k) => (
						<div class={styles.activeBox}>
							<code class={styles.activeKey}>{k()}</code>
							<div class={styles.actions}>
								<button
									type="button"
									class={styles.btn}
									onClick={() => handleCopy(k())}
								>
									复制
								</button>
								<button
									type="button"
									class={styles.btnDanger}
									onClick={handleClear}
								>
									清除
								</button>
							</div>
						</div>
					)}
				</Show>
			</div>

			{/* key 列表 */}
			<div class={styles.card}>
				<h2 class={styles.cardTitle}>服务端 key 列表</h2>
				<Show when={keys.error}>
					<div class={styles.error}>{getErrorMessage(keys.error)}</div>
				</Show>
				<Show when={keys()} fallback={<div class={styles.muted}>加载中…</div>}>
					<For
						each={keys()}
						fallback={<div class={styles.muted}>暂无 key。</div>}
					>
						{(k) => (
							<div class={styles.row}>
								<div class={styles.rowInfo}>
									<span class={styles.rowRole}>{k.role}</span>
									<span class={styles.rowDate}>
										ID {k.id} · {k.created_at.slice(0, 16).replace("T", " ")}
									</span>
								</div>
								<button
									type="button"
									class={styles.btnDanger}
									onClick={() => handleDelete(k.id)}
								>
									删除
								</button>
							</div>
						)}
					</For>
				</Show>
			</div>
		</div>
	);
}
