import { createSignal, Show } from "solid-js";
import { Effect } from "effect";
import { login, register } from "./api";
import { getErrorMessage } from "@/apis/types";
import { useAuth } from "./context";
import styles from "./AuthStatus.module.css";

export default function AuthStatus() {
	const { auth, login: authLogin, logout } = useAuth();
	const [showForm, setShowForm] = createSignal(false);
	const [isRegister, setIsRegister] = createSignal(false);
	const [name, setName] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [error, setError] = createSignal("");

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");
		try {
			const fn = isRegister() ? register : login;
			const result = await Effect.runPromise(fn(name(), password()));
			authLogin(result.id, result.name, result.role, result.token);
			setShowForm(false);
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};

	return (
		<div class={styles.row}>
			<Show when={auth().user}>
				<button type="button" onClick={logout} class={`${styles.btn} ${styles.btnLogout}`}>退出</button>
			</Show>
			<Show when={!auth().user}>
				<button type="button" onClick={() => { setShowForm(!showForm()); setIsRegister(false); }} class={`${styles.btn} ${styles.btnLogin}`}>登录</button>
				<button type="button" onClick={() => { setShowForm(!showForm()); setIsRegister(true); }} class={`${styles.btn} ${styles.btnRegister}`}>注册</button>
			</Show>

			<Show when={showForm()}>
				<div role="dialog" aria-modal="true" class={styles.overlay} onClick={() => setShowForm(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowForm(false); }}>
					<form onSubmit={handleSubmit} class={styles.form} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") setShowForm(false); }}>
						<h3 class={styles.title}>{isRegister() ? "注册" : "登录"}</h3>
						{error() && <p class={styles.error}>{error()}</p>}
						<input placeholder="用户名" value={name()} onInput={(e) => setName(e.currentTarget.value)} class={styles.input} />
						<input type="password" placeholder="密码" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} class={styles.input} />
						<button type="submit" class={`${styles.btn} ${styles.btnSubmit}`}>{isRegister() ? "注册" : "登录"}</button>
						<button type="button" onClick={() => setShowForm(false)} class={`${styles.btn} ${styles.btnCancel}`}>取消</button>
					</form>
				</div>
			</Show>
		</div>
	);
}
