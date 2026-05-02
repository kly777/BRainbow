import { A, Route, Router } from "@solidjs/router";
import { Effect } from "effect";
import { createSignal, type JSX, lazy, Show } from "solid-js";
import { render } from "solid-js/web";
import { login, register } from "@/apis/authApi";
import { getErrorMessage } from "@/apis/types";
import { AuthProvider, useAuth } from "./auth";
import "@/normalize.css";
import "@/markdown.css";
import "./app.css";

import styles from "./App.module.css";

// 懒加载页面组件
const HomePage = lazy(async () => import("@/pages/HomePage"));
const TaskManagerPage = lazy(async () => import("@/pages/TaskManager"));

const CardsListPage = lazy(async () => import("@/pages/notes/CardsList"));
const CardDetailPage = lazy(async () => import("@/pages/notes/CardDetail"));
const CardEditPage = lazy(async () => import("@/pages/notes/CardEdit"));

const OntologyListPage = lazy(
	async () => import("@/pages/ontology/OntologyList"),
);

const Layout = (props: { children?: JSX.Element }) => {
	return (
		<div class={styles.appContainer}>
			<header class={styles.appHeader}>
				<div class={styles.headerContent}>
					<h1 class={styles.appTitle}>
						Brain<span>bow</span>
					</h1>
					<nav class={styles.navLinks}>
						<A href="/" class={styles.navLink} activeClass={styles.active} end>
							H
						</A>
						<A
							href="/tasks"
							class={styles.navLink}
							activeClass={styles.active}
							end
						>
							T
						</A>
						<A href="/c" class={styles.navLink} activeClass={styles.active} end>
							C
						</A>
						<A href="/o" class={styles.navLink} activeClass={styles.active} end>
							O
						</A>
					</nav>
					<AuthStatus />
				</div>
			</header>
			<main class={styles.appContent}>{props.children}</main>
		</div>
	);
};

function AuthStatus() {
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
			authLogin(result.id, result.name, result.role);
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
				<button
					type="button"
					style={{ ...overlayStyle, border: "none" }}
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
							style={{
								...btnStyle,
								width: "100%",
								background: "#6b7280",
							}}
						>
							取消
						</button>
					</form>
				</button>
			</Show>
		</div>
	);
}

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

function App() {
	return (
		<AuthProvider>
			<Router root={Layout}>
				<Route path="/" component={() => <HomePage />} />
				<Route path="/tasks" component={() => <TaskManagerPage />} />
				<Route path="/o" component={() => <OntologyListPage />} />
				<Route path="/c" component={() => <CardsListPage />} />
				<Route path="/c/:id" component={() => <CardDetailPage />} />
				<Route path="/c/edit/:id" component={() => <CardEditPage />} />
			</Router>
		</AuthProvider>
	);
}

const root = document.getElementById("app");
if (!root) {
	const appDiv = document.createElement("div");
	appDiv.id = "app";
	document.body.appendChild(appDiv);
	render(() => <App />, appDiv);
} else {
	render(() => <App />, root);
}
