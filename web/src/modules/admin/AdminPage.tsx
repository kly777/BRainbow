// ── 管理员设置页：开放注册开关 / JWT 密钥状态与轮换 ──

import { notifyError, notifySuccess, showConfirm } from "@lib/utils";
import { useAuth } from "@modules/auth";
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
		try {
			const updated = await updateAdminSettingsE(!current.allow_register);
			mutate(updated);
			notifySuccess(
				updated.allow_register ? "已开放注册" : "已关闭注册",
				updated.allow_register
					? "任何人现在可以注册账号"
					: "仅管理员可创建用户",
			);
		} catch (e) {
			notifyError("更新失败", e);
		} finally {
			setSaving(false);
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
		try {
			const res = await rotateJwtE();
			notifySuccess("密钥已轮换", res.message);
			refetch();
		} catch (e) {
			notifyError("轮换失败", e);
		} finally {
			setRotating(false);
		}
	};

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>管理员设置</h1>

			<Show when={!isAdmin()} fallback={null}>
				<div class={styles.forbidden}>
					<p>仅管理员可访问此页面。</p>
				</div>
			</Show>

			<Show when={isAdmin()}>
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
											s().allow_register ? styles.toggleOn : styles.toggleOff
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
									<button
										type="button"
										class={styles.rotateBtn}
										disabled={rotating()}
										onClick={() => void handleRotate()}
									>
										{rotating() ? "轮换中…" : "轮换密钥"}
									</button>
								</div>
								<p class={styles.hint}>
									轮换后所有现有登录会话立即失效，需要重新登录。
								</p>
							</section>
						</div>
					)}
				</Show>
			</Show>
		</div>
	);
}
