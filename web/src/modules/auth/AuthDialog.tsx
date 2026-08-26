import { Button, Modal } from "@components/ui";
import { AUTH_REQUIRED_EVENT } from "@lib/api";
import { tryAsync } from "@lib/utils";
import {
	changePasswordE,
	loginE,
	logoutE,
	registerE,
	useAuth,
} from "@modules/auth";
import { createSignal, onCleanup, Show } from "solid-js";
import styles from "./AuthStatus.module.css";

type DialogMode = "login" | "password";

/**
 * 登录弹窗（无可见 UI，仅 event 触发）
 *
 * - 监听 `auth:required` 事件 → 弹出登录/注册对话框
 * - 401 错误自动触发该事件
 * - `:loginE` 指令手动触发该事件
 */
export default function AuthStatus() {
	const { login: authLogin, logout } = useAuth();
	const [showForm, setShowForm] = createSignal(false);
	const [dialogMode, setDialogMode] = createSignal<DialogMode>("login");
	const [isRegister, setIsRegister] = createSignal(false);
	const [name, setName] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [oldPassword, setOldPassword] = createSignal("");
	const [newPassword, setNewPassword] = createSignal("");
	const [error, setError] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);

	const open = (mode: "login" | "register" = "login") => {
		setDialogMode("login");
		setIsRegister(mode === "register");
		setError("");
		setName("");
		setPassword("");
		setShowForm(true);
	};

	const _openPasswordDialog = () => {
		setDialogMode("password");
		setError("");
		setOldPassword("");
		setNewPassword("");
		setShowForm(true);
	};

	const onAuthRequired = () => {
		logout();
		if (showForm()) return;
		open("login");
	};

	globalThis.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
	onCleanup(() =>
		globalThis.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired),
	);

	const canSubmitPassword = () =>
		oldPassword().length > 0 && newPassword().length >= 4 && !isSubmitting();

	const canSubmitAuth = () =>
		name().trim().length > 0 && password().length >= 4 && !isSubmitting();

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");

		if (dialogMode() === "password") {
			setIsSubmitting(true);
			const result = await tryAsync(() =>
				changePasswordE(oldPassword(), newPassword()),
			);
			setIsSubmitting(false);
			if (result.ok) {
				setShowForm(false);
			} else {
				setError(result.error.message);
			}
			return;
		}

		setIsSubmitting(true);
		const result = await tryAsync(() =>
			(isRegister() ? registerE : loginE)(name(), password()),
		);
		setIsSubmitting(false);
		if (result.ok) {
			const { id, name: uname, role, token } = result.value;
			authLogin(id, uname, role, token);
			setShowForm(false);
		} else {
			setError(result.error.message);
		}
	};

	const _handleLogout = async () => {
		// 登出失败不影响本地 logout
		await tryAsync(() => logoutE());
		logout();
	};

	return (
		<Modal
			isOpen={showForm()}
			onClose={() => setShowForm(false)}
			title={
				dialogMode() === "password"
					? "修改密码"
					: isRegister()
						? "注册"
						: "登录"
			}
		>
			<form onSubmit={handleSubmit} class={styles.authForm}>
				{error() && <p class={styles.error}>{error()}</p>}

				<Show when={dialogMode() === "password"}>
					<input
						type="password"
						placeholder="当前密码"
						aria-label="当前密码"
						value={oldPassword()}
						onInput={(e) => setOldPassword(e.currentTarget.value)}
						class={styles.input}
						disabled={isSubmitting()}
					/>
					<input
						type="password"
						placeholder="新密码（至少4位）"
						aria-label="新密码"
						value={newPassword()}
						onInput={(e) => setNewPassword(e.currentTarget.value)}
						class={styles.input}
						disabled={isSubmitting()}
					/>
					<div class={styles.actions}>
						<Button
							type="submit"
							variant="primary"
							disabled={!canSubmitPassword()}
						>
							{isSubmitting() ? "修改中..." : "修改密码"}
						</Button>
					</div>
				</Show>

				<Show when={dialogMode() !== "password"}>
					<input
						placeholder="用户名"
						aria-label="用户名"
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
						class={styles.input}
						disabled={isSubmitting()}
					/>
					<input
						type="password"
						placeholder="密码"
						aria-label="密码"
						value={password()}
						onInput={(e) => setPassword(e.currentTarget.value)}
						class={styles.input}
						disabled={isSubmitting()}
					/>
					<div class={styles.actions}>
						<Button type="submit" variant="primary" disabled={!canSubmitAuth()}>
							{isSubmitting()
								? isRegister()
									? "注册中..."
									: "登录中..."
								: isRegister()
									? "注册"
									: "登录"}
						</Button>
						<Button
							variant="ghost"
							onClick={() => setIsRegister(!isRegister())}
							disabled={isSubmitting()}
						>
							{isRegister() ? "已有账号？登录" : "没有账号？注册"}
						</Button>
					</div>
				</Show>
			</form>
		</Modal>
	);
}
