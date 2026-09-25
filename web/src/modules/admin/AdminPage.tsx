// ── 管理员设置页：开放注册开关 / JWT 密钥状态与轮换 / 系统信息 ──

import { useAuth } from "@app/context/auth.tsx";
import { ErrorRetry, PageHead } from "@components/ui";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createResource, createSignal, Show } from "solid-js";
import styles from "./AdminPage.module.css";
import {
	getAdminSettingsE,
	getSystemInfoE,
	rotateJwtE,
	updateAdminSettingsE,
} from "./api.ts";
import JwtCard from "./components/JwtCard.tsx";
import RegistrationCard from "./components/RegistrationCard.tsx";
import ServerInfoCard from "./components/ServerInfoCard.tsx";
import ServiceInfoCard from "./components/ServiceInfoCard.tsx";
import StatCards from "./components/StatCards.tsx";

/**
 * 管理员设置页：开放注册开关 / JWT 密钥状态与轮换 / 系统信息。
 *
 * 五张卡片都已下钻到 `components/`（体检表"内联展示组件"最后一处：本文件原 401 行，
 * 其中 9 条内联 SVG path 与三块系统信息占了大头）。页面只留取数与两个操作。
 */
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
				{/* ── 系统信息三张卡片 ── */}
				<Show when={systemInfo()}>
					{(info) => (
						<>
							<ServiceInfoCard info={info()} />
							<StatCards stats={info().stats} onRefresh={() => refetchInfo()} />
							<ServerInfoCard info={info()} />
						</>
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
									<RegistrationCard
										allowRegister={s().allow_register}
										saving={saving()}
										onToggle={() => void toggleRegister()}
									/>
									<JwtCard
										jwtSecretSet={s().jwt_secret_set}
										jwtSecretLen={s().jwt_secret_len}
										rotating={rotating()}
										onRotate={() => void handleRotate()}
									/>
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
