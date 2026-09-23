// ── 免登录：把登录态直接写进 storageState ──
//
// 应用从 localStorage 的 `brainbow_user` 读 token（见 shared/api/token.ts），
// AuthGuard 只做本地判断、不向接口校验；而接口整体被 `page.route` 造假，
// 所以这里用一个**假 token** 就够 —— e2e 不需要真账号，也不需要碰任何真实数据。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "http://localhost:3001";
// 本包是 ESM（package.json 的 type: module），没有 __dirname
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function globalSetup() {
	const dir = path.join(HERE, ".auth");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "state.json"),
		JSON.stringify({
			cookies: [],
			origins: [
				{
					origin: ORIGIN,
					localStorage: [
						{
							name: "brainbow_user",
							value: JSON.stringify({
								id: 1,
								name: "e2e",
								role: "user",
								token: "e2e-token",
							}),
						},
					],
				},
			],
		}),
	);
}
