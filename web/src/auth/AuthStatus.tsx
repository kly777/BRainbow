import { createSignal, onCleanup, Show } from "solid-js";
import { Effect } from "effect";
import { login, register } from "./api.ts";
import { getErrorMessage } from "../apis/types/index.ts";
import { AUTH_REQUIRED_EVENT } from "../apis/request.ts";
import { useAuth } from "./context.tsx";
import styles from "./AuthStatus.module.css";

export default function AuthStatus() {
    const { auth, login: authLogin, logout } = useAuth();
    const [showForm, setShowForm] = createSignal(false);
    const [isRegister, setIsRegister] = createSignal(false);
    const [name, setName] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [error, setError] = createSignal("");

    // 监听 401 → 自动登出 + 弹出登录框
    const onAuthRequired = () => {
        logout();
        setIsRegister(false);
        setError("");
        setName("");
        setPassword("");
        setShowForm(true);
    };
    globalThis.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    onCleanup(() =>
        globalThis.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    );

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setError("");
        const exit = await Effect.runPromiseExit(
            (isRegister() ? register : login)(name(), password()),
        );
        if (exit._tag === "Success") {
            const { id, name: uname, role, token } = exit.value;
            authLogin(id, uname, role, token);
            setShowForm(false);
        } else {
            setError(getErrorMessage(exit.cause));
        }
    };

    return (
        <div class={styles.row}>
            <Show when={auth().user}>
                <button
                    type="button"
                    onClick={logout}
                    class={`${styles.btn} ${styles.btnLogout}`}
                >
                    退出
                </button>
            </Show>
            <Show when={!auth().user}>
                <button
                    type="button"
                    onClick={() => {
                        setShowForm(!showForm());
                        setIsRegister(false);
                    }}
                    class={`${styles.btn} ${styles.btnLogin}`}
                >
                    登录
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setShowForm(!showForm());
                        setIsRegister(true);
                    }}
                    class={`${styles.btn} ${styles.btnRegister}`}
                >
                    注册
                </button>
            </Show>

            <Show when={showForm()}>
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
                            {isRegister() ? "注册" : "登录"}
                        </h3>
                        {error() && <p class={styles.error}>{error()}</p>}
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
                        <button
                            type="submit"
                            class={`${styles.btn} ${styles.btnSubmit}`}
                        >
                            {isRegister() ? "注册" : "登录"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            class={`${styles.btn} ${styles.btnCancel}`}
                        >
                            取消
                        </button>
                    </form>
                </div>
            </Show>
        </div>
    );
}
