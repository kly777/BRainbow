import { request } from "../apis/request.ts";

export interface AuthUser {
    id: number;
    name: string;
    role: string;
    token: string;
}

export const loginE = (
    name: string,
    password: string,
): Promise<AuthUser> =>
    request("/user/loginE", {
        method: "POST",
        body: JSON.stringify({ name, password }),
    });

export const registerE = (
    name: string,
    password: string,
): Promise<AuthUser> =>
    request("/user/registerE", {
        method: "POST",
        body: JSON.stringify({ name, password }),
    });
