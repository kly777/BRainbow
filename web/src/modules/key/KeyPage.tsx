// ── API Key 管理页 ──
// dev 环境免登录可生成（后端 APP_ENV=dev）；prod 需登录（AuthGuard）。

import { useAuth } from "@app/context/auth.tsx";
import { Button, LoadingSkeleton, PageHead } from "@components/ui";
import { getApiKey, getErrorMessage } from "@shared/api";
import {
	copyText,
	fmtFull,
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { ApiKeyInfo } from "./api.ts";
import { createKeyE, deleteKeyE, listKeysE } from "./api.ts";
import styles from "./KeyPage.module.css";

const NewKeyBox: Component<{
	k: () => string;
	onCopy: (key: string) => void;
	onApply: (key: string) => void;
}> = (props) => (
	<div class={styles.newKeyBox}>
		<div class={styles.newKeyLabel}>新 key（仅显示一次）：</div>
		<code class={styles.newKey}>{props.k()}</code>
		<div class={styles.actions}>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => props.onCopy(props.k())}
			>
				复制
			</Button>
			<Button
				variant="primary"
				size="sm"
				onClick={() => props.onApply(props.k())}
			>
				应用此 key
			</Button>
		</div>
	</div>
);

const ActiveKeyBox: Component<{
	k: () => string;
	onCopy: (key: string) => void;
	onClear: () => void;
}> = (props) => (
	<div class={styles.activeBox}>
		<code class={styles.activeKey}>{props.k()}</code>
		<div class={styles.actions}>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => props.onCopy(props.k())}
			>
				复制
			</Button>
			<Button variant="danger" size="sm" onClick={props.onClear}>
				清除
			</Button>
		</div>
	</div>
);

const KeyRow: Component<{
	k: ApiKeyInfo;
	onDelete: (id: number) => void;
}> = (props) => (
	<div class={styles.row}>
		<div class={styles.rowInfo}>
			<span class={styles.rowRole}>{props.k.role}</span>
			<span class={styles.rowDate}>
				ID {props.k.id} · {fmtFull(props.k.created_at)}
			</span>
		</div>
		<Button
			variant="danger"
			size="sm"
			onClick={() => props.onDelete(props.k.id)}
		>
			删除
		</Button>
	</div>
);

export default function KeyPage() {
	const { setApiKey } = useAuth();
	const [keys, { refetch }] = createResource(() => listKeysE());
	const [newKey, setNewKey] = createSignal<string | null>(null);
	const [generating, setGenerating] = createSignal(false);

	// 本地 keys 状态用于乐观更新
	const [localKeys, setLocalKeys] = createSignal<ApiKeyInfo[]>([]);

	// 同步远程数据到本地状态
	const displayKeys = () => {
		const remoteKeys = keys();
		if (remoteKeys !== undefined) {
			// 如果本地状态为空，初始化为远程数据
			if (localKeys().length === 0 && remoteKeys.length > 0) {
				setLocalKeys(remoteKeys);
			}
			return localKeys();
		}
		return [];
	};

	const activeKey = () => getApiKey();

	const handleGenerate = async () => {
		setGenerating(true);
		const result = await tryAsync(() => createKeyE());
		setGenerating(false);
		if (result.ok) {
			setNewKey(result.value.key ?? null);
			// 乐观更新：立即添加到本地列表
			if (result.value) {
				setLocalKeys((prev) => [result.value, ...prev]);
			}
			notifySuccess("已生成 API key", "复制后保存，仅显示一次");
		} else {
			notifyError("生成 key 失败", result.error);
		}
	};

	const handleCopy = async (key: string) => {
		if (await copyText(key)) {
			notifySuccess("已复制到剪贴板");
		} else {
			notifyError("复制失败");
		}
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
		const confirmed = await showConfirm({
			title: "删除 API key",
			message: "删除后依赖该 key 的脚本将无法认证。确定删除？",
			variant: "danger",
		});
		if (!confirmed) return;

		// 乐观更新：立即从本地列表移除
		const previousKeys = localKeys();
		setLocalKeys((prev) => prev.filter((k) => k.id !== id));

		const result = await tryAsync(() => deleteKeyE(id));
		if (result.ok) {
			notifySuccess("已删除");
		} else {
			// 删除失败，回滚到之前的状态
			setLocalKeys(previousKeys);
			notifyError("删除失败", result.error);
		}
	};

	const emptyKeys = <div class={styles.muted}>暂无 key。</div>;

	return (
		<div class={styles.page}>
			<PageHead
				title="API Key"
				desc="生成长期有效的 API key（仅登录后可操作）。key 永不过期，测试/脚本请求带 X-API-Key 头即可认证，无需再登录。"
			/>

			{/* 生成 */}
			<div class={styles.card}>
				<h2 class={styles.cardTitle}>生成新 key</h2>
				<Button
					variant="primary"
					size="sm"
					onClick={handleGenerate}
					disabled={generating()}
				>
					{generating() ? "生成中…" : "＋ 生成"}
				</Button>

				<Show when={newKey()}>
					{(k) => <NewKeyBox k={k} onCopy={handleCopy} onApply={handleApply} />}
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
						<ActiveKeyBox k={k} onCopy={handleCopy} onClear={handleClear} />
					)}
				</Show>
			</div>

			{/* key 列表 */}
			<div class={styles.card}>
				<h2 class={styles.cardTitle}>服务端 key 列表</h2>
				<Show when={keys.error}>
					<div class={styles.error}>
						{getErrorMessage(keys.error)}
						<Button variant="primary" size="sm" onClick={refetch}>
							重试
						</Button>
					</div>
				</Show>
				<Show when={!keys.loading} fallback={<LoadingSkeleton rows={2} />}>
					<For each={displayKeys()} fallback={emptyKeys}>
						{(k) => <KeyRow k={k} onDelete={handleDelete} />}
					</For>
				</Show>
			</div>
		</div>
	);
}
