import { request } from "../apis/request.ts";

export interface AuthUser {
    id: number;
    name: string;
    role: string;
    token: string;
}

export const login = (
    name: string,
    password: string,
): Promise<AuthUser> =>
    request("/user/login", {
        method: "POST",
        body: JSON.stringify({ name, password }),
    });

export const register = (
    name: string,
    password: string,
): Promise<AuthUser> =>
    request("/user/register", {
        method: "POST",
        body: JSON.stringify({ name, password }),
    });
