// ── 管理员设置页：开放注册开关 / JWT 密钥状态与轮换 ──

import { useAuth } from "@app/context/auth.tsx";
import { Button, PageHead } from "@components/ui";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createResource, createSignal, Show } from "solid-js";
import styles from "./AdminPage.module.css";
import { getAdminSettingsE, rotateJwtE, updateAdminSettingsE } from "./api.ts";

export default function AdminPage() {
	const { auth } = useAuth();
	const [settings, { mutate, refetch }] = createResource(getAdminSettingsE);
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
					<div class={styles.loading}>
						加载失败
						<Button variant="primary" size="sm" onClick={refetch}>
							重试
						</Button>
					</div>
				</Show>
			</Show>
		</div>
	);
}
