import { createSignal, Show } from "solid-js";
import { Effect } from "effect";
import { login, register } from "@/apis/authApi";
import { getErrorMessage } from "@/apis/types";
import { useAuth } from "./auth";

const btnStyle = {
	padding: "6px 14px",
	background: "#3b82f6",
	color: "white",
	border: "none",
	"border-radius": "6px",
	cursor: "pointer",
	"font-size": "13px",
};

const overlayStyle = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	background: "rgba(0,0,0,0.3)",
	display: "flex",
	"align-items": "center",
	"justify-content": "center",
	"z-index": 1000,
} as const;

const formStyle = {
	background: "white",
	padding: "24px",
	"border-radius": "12px",
	display: "flex",
	"flex-direction": "column" as const,
	gap: "12px",
	"min-width": "280px",
	"box-shadow": "0 4px 20px rgba(0,0,0,0.15)",
};

const inputStyle = {
	padding: "10px",
	border: "1px solid #d1d5db",
	"border-radius": "6px",
	"font-size": "14px",
};

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

	const handleLogout = () => {
		logout();
		setName("");
		setPassword("");
	};

	return (
		<div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
			<Show when={auth().user}>
				<button
					type="button"
					onClick={handleLogout}
					style={{ ...btnStyle, background: "#6b7280" }}
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
					style={btnStyle}
				>
					登录
				</button>
				<button
					type="button"
					onClick={() => {
						setShowForm(!showForm());
						setIsRegister(true);
					}}
					style={{ ...btnStyle, background: "#8b5cf6" }}
				>
					注册
				</button>
			</Show>
			<Show when={showForm()}>
				<div
					role="dialog"
					aria-modal="true"
					style={{ ...overlayStyle }}
					onClick={() => setShowForm(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setShowForm(false);
					}}
				>
					<form
						onSubmit={handleSubmit}
						style={formStyle}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") setShowForm(false);
						}}
					>
						<h3 style={{ margin: 0 }}>{isRegister() ? "注册" : "登录"}</h3>
						{error() && (
							<p style={{ color: "red", "font-size": "13px" }}>{error()}</p>
						)}
						<input
							placeholder="用户名"
							value={name()}
							onInput={(e) => setName(e.currentTarget.value)}
							style={inputStyle}
						/>
						<input
							type="password"
							placeholder="密码"
							value={password()}
							onInput={(e) => setPassword(e.currentTarget.value)}
							style={inputStyle}
						/>
						<button type="submit" style={{ ...btnStyle, width: "100%" }}>
							{isRegister() ? "注册" : "登录"}
						</button>
						<button
							type="button"
							onClick={() => setShowForm(false)}
							style={{ ...btnStyle, width: "100%", background: "#6b7280" }}
						>
							取消
						</button>
					</form>
				</div>
			</Show>
		</div>
	);
}
