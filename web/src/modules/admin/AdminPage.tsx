// ── 管理员设置页：开放注册开关 / JWT 密钥状态与轮换 / 系统信息 ──

import { useAuth } from "@app/context/auth.tsx";
import { Button, ErrorRetry, PageHead } from "@components/ui";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./AdminPage.module.css";
import {
	getAdminSettingsE,
	getSystemInfoE,
	type ModuleStats,
	rotateJwtE,
	updateAdminSettingsE,
} from "./api.ts";
import { formatBytes, formatUptime, getStatValue } from "./utils.ts";

const STAT_ITEMS: { key: keyof ModuleStats; label: string; icon: string }[] = [
	{
		key: "users",
		label: "用户",
		icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
	},
	{
		key: "tasks",
		label: "任务",
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
	},
	{
		key: "cards",
		label: "卡片",
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
	},
	{
		key: "memories",
		label: "记忆",
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
	},
	{
		key: "bookmarks",
		label: "书签",
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
	},
	{
		key: "articles",
		label: "文章",
		icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
	},
	{
		key: "conversations",
		label: "对话",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
	},
	{
		key: "chat_trees",
		label: "AI 对话",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
	},
	{
		key: "ontologies",
		label: "本体",
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
	},
];

export default function AdminPage() {
	const { auth } = useAuth();
	const [settings, { mutate, refetch }] = createResource(getAdminSettingsE);
	const [systemInfo, { refetch: refetchInfo }] = createResource(getSystemInfoE);
	const [saving, setSaving] = createSignal(false);
	const [rotating, setRotating] = createSignal(false);

	const isAdmin = () => auth().isAdmin;

	const toggleRegister = async () => {
		const current = settings();
		if (!current) return;
		setSaving(true);
		const result = await tryAsync(() =>
			updateAdminSettingsE(!current.allow_register),
		);
		setSaving(false);
		if (result.ok) {
			mutate(result.value);
			notifySuccess(
				result.value.allow_register ? "已开放注册" : "已关闭注册",
				result.value.allow_register
					? "任何人现在可以注册账号"
					: "仅管理员可创建用户",
			);
		} else {
			notifyError("更新失败", result.error);
		}
	};

	const handleRotate = async () => {
		const confirmed = await showConfirm({
			title: "轮换 JWT 密钥",
			message:
				"将生成新的 JWT 密钥并立即生效。所有用户（包括你自己）都会被退出登录，需要重新登录。确定继续？",
			variant: "danger",
		});
		if (!confirmed) return;
		setRotating(true);
		const result = await tryAsync(() => rotateJwtE());
		setRotating(false);
		if (result.ok) {
			notifySuccess("密钥已轮换", result.value.message);
			refetch();
		} else {
			notifyError("轮换失败", result.error);
		}
	};

	return (
		<div class={styles.page}>
			<PageHead title="管理员设置" />

			<Show when={!isAdmin()} fallback={null}>
				<div class={styles.forbidden}>
					<p>仅管理员可访问此页面。</p>
				</div>
			</Show>

			<Show when={isAdmin()}>
				{/* ── 系统信息卡片 ── */}
				<Show when={systemInfo()}>
					{(info) => (
						<section class={styles.card}>
							<h2 class={styles.cardTitle}>服务信息</h2>
							<div class={styles.infoGrid}>
								<div class={styles.infoItem}>
									<span class={styles.infoLabel}>版本</span>
									<span class={styles.infoValue}>v{info().version}</span>
								</div>
								<div class={styles.infoItem}>
									<span class={styles.infoLabel}>运行时长</span>
									<span class={styles.infoValue}>
										{formatUptime(info().uptime_secs)}
									</span>
								</div>
								<div class={styles.infoItem}>
									<span class={styles.infoLabel}>数据库版本</span>
									<span class={styles.infoValue}>
										Schema v{info().db_version}
									</span>
								</div>
								<div class={styles.infoItem}>
									<span class={styles.infoLabel}>数据库大小</span>
									<span class={styles.infoValue}>
										{formatBytes(info().db_size_bytes)}
									</span>
								</div>
							</div>
						</section>
					)}
				</Show>

				{/* ── 数据统计卡片 ── */}
				<Show when={systemInfo()}>
					{(info) => (
						<section class={styles.card}>
							<div class={styles.cardHead}>
								<h2 class={styles.cardTitle}>数据统计</h2>
								<Button variant="ghost" size="sm" onClick={() => refetchInfo()}>
									刷新
								</Button>
							</div>
							<div class={styles.statsGrid}>
								<For each={STAT_ITEMS}>
									{(item) => (
										<div class={styles.statItem}>
											<div class={styles.statIcon}>
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="1.5"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<path d={item.icon} />
												</svg>
											</div>
											<div class={styles.statBody}>
												<span class={styles.statValue}>
													{getStatValue(info().stats, item.key)}
												</span>
												<span class={styles.statLabel}>{item.label}</span>
											</div>
										</div>
									)}
								</For>
							</div>
						</section>
					)}
				</Show>

				{/* ── 设置卡片 ── */}
				<Show
					when={settings.error}
					fallback={
						<Show
							when={settings()}
							fallback={<div class={styles.loading}>加载设置中…</div>}
						>
							{(s) => (
								<div class={styles.sections}>
									<section class={styles.card}>
										<div class={styles.cardHead}>
											<div>
												<h2>开放注册</h2>
												<p class={styles.desc}>
													控制新用户能否自行注册账号。公网部署建议保持关闭。
												</p>
											</div>
											<button
												type="button"
												class={
													s().allow_register
														? styles.toggleOn
														: styles.toggleOff
												}
												classList={{ [styles.disabled]: saving() }}
												role="switch"
												aria-checked={s().allow_register}
												disabled={saving()}
												onClick={() => void toggleRegister()}
											>
												<span class={styles.toggleKnob} />
												{s().allow_register ? "开放" : "关闭"}
											</button>
										</div>
									</section>

									<section class={styles.card}>
										<div class={styles.cardHead}>
											<div>
												<h2>JWT 密钥</h2>
												<p class={styles.desc}>
													状态：
													{s().jwt_secret_set
														? `已持久化（${s().jwt_secret_len} 字符）`
														: "未持久化（环境变量或随机密钥，重启后会话失效）"}
												</p>
											</div>
											<Button
												variant="danger"
												size="sm"
												disabled={rotating()}
												onClick={() => void handleRotate()}
											>
												{rotating() ? "轮换中…" : "轮换密钥"}
											</Button>
										</div>
										<p class={styles.hint}>
											轮换后所有现有登录会话立即失效，需要重新登录。
										</p>
									</section>
								</div>
							)}
						</Show>
					}
				>
					<ErrorRetry
						error={settings.error}
						onRetry={refetch}
						message="加载失败"
					/>
				</Show>
			</Show>
		</div>
	);
}
