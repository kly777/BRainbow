import { request } from "../apis/request.ts";

export interface AuthUser {
	id: number;
	name: string;
	role: string;
	token: string;
}

export const loginE = (name: string, password: string): Promise<AuthUser> =>
	request("/user/login", {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});

export const registerE = (name: string, password: string): Promise<AuthUser> =>
	request("/user/register", {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});

export const logoutE = (): Promise<{ ok: boolean }> =>
	request("/user/logout", { method: "POST" });

export const changePasswordE = (
	oldPassword: string,
	newPassword: string,
): Promise<{ ok: boolean }> =>
	request("/user/password", {
		method: "POST",
		body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
	});
