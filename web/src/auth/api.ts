import { type Effect, Schema } from "effect";
import { request } from "../apis/request.ts";
import type { ApiErrorType } from "../apis/types/index.ts";

export interface AuthUser {
	id: number;
	name: string;
	role: string;
	token: string;
}

const AuthUserSchema = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	role: Schema.String,
	token: Schema.String,
});

export const login = (
	name: string,
	password: string,
): Effect.Effect<AuthUser, ApiErrorType> =>
	request("/user/login", AuthUserSchema, {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});

export const register = (
	name: string,
	password: string,
): Effect.Effect<AuthUser, ApiErrorType> =>
	request("/user/register", AuthUserSchema, {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});
