// ── 3D 模型预览：格式判定、错误翻译、以及降级路径 ──
//
// 渲染本身（three + WebGL）在 jsdom 里跑不了，这里钉的是它周边能钉的部分：
// 该用哪个 loader、.gltf 能不能单文件加载、错误怎么说人话、加载不出来时界面
// 不能停在空白上。真正的观感要人工在浏览器里看。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gltfNeedsExternalFiles, modelFormatOf } from "../lib/model.ts";
import { __internal, ModelViewer } from "./ModelViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("modelFormatOf", () => {
	it("认四种模型扩展名（大小写与空白容忍）", () => {
		expect(modelFormatOf("a.glb")).toBe("glb");
		expect(modelFormatOf("SCENE.GLTF")).toBe("gltf");
		expect(modelFormatOf("  part.stl ")).toBe("stl");
		expect(modelFormatOf("mesh.Obj")).toBe("obj");
	});

	it("其它扩展名不认（.ply 归泼溅查看器，别抢）", () => {
		expect(modelFormatOf("scan.ply")).toBeUndefined();
		expect(modelFormatOf("a.glb.bak")).toBeUndefined();
		expect(modelFormatOf("a")).toBeUndefined();
	});
});

describe("gltfNeedsExternalFiles", () => {
	it("引用外部 .bin / 贴图时返回 true（data: 内联的不算）", () => {
		expect(
			gltfNeedsExternalFiles(
				JSON.stringify({
					buffers: [
						{ uri: "scene.bin" },
						{ uri: "data:application/octet-stream;base64,AA" },
					],
				}),
			),
		).toBe(true);
		expect(
			gltfNeedsExternalFiles(
				JSON.stringify({
					buffers: [{ uri: "data:application/octet-stream;base64,AA" }],
				}),
			),
		).toBe(false);
	});

	it("不是 JSON 时不抢话（交给 loader 报错）", () => {
		expect(gltfNeedsExternalFiles("not json at all")).toBe(false);
	});
});

describe("readableError", () => {
	it("把 loader 的英文原话翻成人话", () => {
		expect(
			__internal.readableError(
				new Error("THREE.GLTFLoader: No DRACOLoader instance provided"),
			),
		).toContain("DRACO");
		expect(
			__internal.readableError(new Error("Error creating WebGL context")),
		).toContain("WebGL2");
		expect(
			__internal.readableError(new Error("Unexpected token < in JSON")),
		).toContain("损坏");
		expect(__internal.readableError(new Error("别的错"))).toContain("别的错");
	});
});

describe("ModelViewer（降级路径）", () => {
	it("名不对时给可读提示，而不是空白画布", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array(64), {
						status: 206,
						headers: { "content-range": "bytes 0-63/64" },
					}),
			),
		);
		const host = document.createElement("div");
		document.body.innerHTML = "";
		document.body.appendChild(host);
		render(
			() => (
				<ModelViewer
					item={item({
						original_name: "模型.xyz",
						mime_type: "application/octet-stream",
						file_category: "other",
					})}
				/>
			),
			host,
		);
		await settle(() => (host.textContent ?? "").includes("不可用"));
		expect(host.textContent).toContain(".glb / .gltf / .stl / .obj");
		expect(host.querySelector("canvas")).toBeTruthy();
	});

	it("文件太大时不下载，直接给提示", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array(8), {
						status: 206,
						headers: { "content-range": "bytes 0-7/900000000" },
					}),
			),
		);
		const host = document.createElement("div");
		document.body.innerHTML = "";
		document.body.appendChild(host);
		render(
			() => (
				<ModelViewer
					item={item({
						original_name: "big.glb",
						mime_type: "application/octet-stream",
						file_category: "other",
					})}
				/>
			),
			host,
		);
		await settle(() => (host.textContent ?? "").includes("256 MB"));
		expect(host.textContent).toContain("下载后用本地工具");
	});
});
