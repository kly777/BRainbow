import { createContext, createSignal, type JSX, useContext } from "solid-js";

export interface AuthState {
	user: { id: number; name: string; role: string } | null;
	isAdmin: boolean;
	/** API key（测试/脚本认证），有值即视为已认证 */
	apiKey: string | null;
}

const AuthContext = createContext<{
	auth: () => AuthState;
	login: (id: number, name: string, role: string, token: string) => void;
	logout: () => void;
	setApiKey: (key: string | null) => void;
}>();

const STORAGE_KEY = "brainbow_user";
const API_KEY_STORAGE_KEY = "brainbow_api_key";

function loadFromStorage() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const user = JSON.parse(raw);
		if (user?.id && user?.name) return user;
	} catch {
		/* ignore parse errors */
	}
	return null;
}

export function loadApiKey(): string | null {
	try {
		return localStorage.getItem(API_KEY_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function AuthProvider(props: { children: JSX.Element }) {
	const stored = loadFromStorage();
	const [auth, setAuth] = createSignal<AuthState>({
		user: stored,
		isAdmin: stored?.role === "admin",
		apiKey: loadApiKey(),
	});

	const ctxValue = {
		auth,
		login: (id: number, name: string, role: string, token: string) => {
			const user = { id, name, role, token };
			localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
			setAuth({ user, isAdmin: role === "admin", apiKey: loadApiKey() });
		},
		logout: () => {
			localStorage.removeItem(STORAGE_KEY);
			setAuth({ user: null, isAdmin: false, apiKey: loadApiKey() });
		},
		setApiKey: (key: string | null) => {
			if (key) {
				localStorage.setItem(API_KEY_STORAGE_KEY, key);
			} else {
				localStorage.removeItem(API_KEY_STORAGE_KEY);
			}
			setAuth((prev) => ({ ...prev, apiKey: key }));
		},
	};

	return (
		<AuthContext.Provider value={ctxValue}>
			{props.children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) {
		console.error("useAuth: 组件未包裹在 AuthProvider 内，返回空状态");
		return {
			auth: () => ({ user: null, isAdmin: false, apiKey: null }) as const,
			login: () => {},
			logout: () => {},
			setApiKey: () => {},
		};
	}
	return ctx;
}

export function getToken(): string | null {
	return loadFromStorage()?.token ?? null;
}

export function getApiKey(): string | null {
	return loadApiKey();
}
