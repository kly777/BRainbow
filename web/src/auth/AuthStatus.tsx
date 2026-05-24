import { createSignal, onCleanup, Show } from "solid-js";
import { Effect } from "effect";
import { login, register } from "./api.ts";
import { getErrorMessage } from "../apis/types/index.ts";
import { AUTH_REQUIRED_EVENT } from "../apis/request.ts";
import { useAuth } from "./context.tsx";
import styles from "./AuthStatus.module.css";

/**
 * 登录弹窗（无可见 UI，仅 event 触发）
 *
 * - 监听 `auth:required` 事件 → 弹出登录/注册对话框
 * - 401 错误自动触发该事件
 * - `:login` 指令手动触发该事件
 */
export default function AuthStatus() {
    const { login: authLogin, logout } = useAuth();
    const [showForm, setShowForm] = createSignal(false);
    const [isRegister, setIsRegister] = createSignal(false);
    const [name, setName] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [error, setError] = createSignal("");

    const open = (mode: "login" | "register" = "login") => {
        setIsRegister(mode === "register");
        setError("");
        setName("");
        setPassword("");
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
                    <button
                        type="button"
                        onClick={() => setShowForm(false)}
                        class={styles.btnCancel}
                    >
                        取消
                    </button>
                </form>
            </div>
        </Show>
    );
}
