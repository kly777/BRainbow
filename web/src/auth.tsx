import { createContext, createSignal, type JSX, useContext } from "solid-js";

export interface AuthState {
	user: { id: number; name: string; role: string } | null;
	isAdmin: boolean;
}

const AuthContext = createContext<{
	auth: () => AuthState;
	login: (id: number, name: string, role: string) => void;
	logout: () => void;
}>();

const STORAGE_KEY = "brainbow_user";

function loadFromStorage() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const user = JSON.parse(raw);
		if (user?.id && user?.name) return user;
	} catch {}
	return null;
}

export function AuthProvider(props: { children: JSX.Element }) {
	const stored = loadFromStorage();
	const [auth, setAuth] = createSignal<AuthState>({
		user: stored,
		isAdmin: stored?.role === "admin",
	});

	const ctxValue = {
		auth,
		login: (id: number, name: string, role: string) => {
			const user = { id, name, role };
			localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
			setAuth({ user, isAdmin: role === "admin" });
		},
		logout: () => {
			localStorage.removeItem(STORAGE_KEY);
			setAuth({ user: null, isAdmin: false });
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
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}

export function getUserId(): number | null {
	return loadFromStorage()?.id ?? null;
}
