import { createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { AUTH_REQUIRED_EVENT } from "../apis/request.ts";
import { getErrorMessage } from "../apis/types/index.ts";
import styles from "./AuthStatus.module.css";
import { changePasswordE, loginE, logoutE, registerE } from "./api.ts";
import { useAuth } from "./context.tsx";

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

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");
		if (dialogMode() === "password") {
			try {
				await changePasswordE(oldPassword(), newPassword());
				setShowForm(false);
			} catch (e) {
				setError(getErrorMessage(e));
			}
			return;
		}
		try {
			const user = await (isRegister() ? registerE : loginE)(
				name(),
				password(),
			);
			const { id, name: uname, role, token } = user;
			authLogin(id, uname, role, token);
			setShowForm(false);
			// 登录后刷新页面
			window.location.reload();
		} catch (e) {
			setError(getErrorMessage(e));
		}
	};

	const _handleLogout = async () => {
		try {
			await logoutE();
		} catch {
			/* ignore network errors — local logout anyway */
		}
		logout();
	};

	return (
		<Show when={showForm()}>
			<Portal>
				<div
					role="dialog"
					aria-modal="true"
					class={styles.overlay}
					onClick={() => setShowForm(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setShowForm(false);
					}}
				>
					<form
						onSubmit={handleSubmit}
						class={styles.form}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") setShowForm(false);
						}}
					>
						<h3 class={styles.title}>
							{dialogMode() === "password"
								? "修改密码"
								: isRegister()
									? "注册"
									: "登录"}
						</h3>
						{error() && <p class={styles.error}>{error()}</p>}

						<Show when={dialogMode() === "password"}>
							<input
								type="password"
								placeholder="当前密码"
								value={oldPassword()}
								onInput={(e) => setOldPassword(e.currentTarget.value)}
								class={styles.input}
							/>
							<input
								type="password"
								placeholder="新密码（至少4位）"
								value={newPassword()}
								onInput={(e) => setNewPassword(e.currentTarget.value)}
								class={styles.input}
							/>
							<div class={styles.actions}>
								<button type="submit" class={styles.btnSubmit}>
									修改密码
								</button>
							</div>
						</Show>

						<Show when={dialogMode() !== "password"}>
							<input
								placeholder="用户名"
								value={name()}
								onInput={(e) => setName(e.currentTarget.value)}
								class={styles.input}
							/>
							<input
								type="password"
								placeholder="密码"
								value={password()}
								onInput={(e) => setPassword(e.currentTarget.value)}
								class={styles.input}
							/>
							<div class={styles.actions}>
								<button type="submit" class={styles.btnSubmit}>
									{isRegister() ? "注册" : "登录"}
								</button>
								<button
									type="button"
									class={styles.btnLink}
									onClick={() => setIsRegister(!isRegister())}
								>
									{isRegister() ? "已有账号？登录" : "没有账号？注册"}
								</button>
							</div>
						</Show>
						<button
							type="button"
							onClick={() => setShowForm(false)}
							class={styles.btnCancel}
						>
							取消
						</button>
					</form>
				</div>
			</Portal>
		</Show>
	);
}
