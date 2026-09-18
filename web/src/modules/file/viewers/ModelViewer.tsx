// ── 3D 模型预览（.glb / .gltf / .stl / .obj）—— 渲染交给 three.js ──
//
// 为什么用三方库：网格要处理材质、光照、法线、坐标系、相机交互，自己写一遍既没收益
// 也修不动；three.js 是这块的社区标准，维护活跃。代价是体积（未压缩 ~600KB），
// 所以**整块懒加载**：注册表虽然是静态引入本组件，但 three、三个 loader 与 OrbitControls
// 都在画布挂载后才 `await import`（与 DOMPurify 在 docx 查看器里的处理同一个套路），
// 首屏同步链一点都不沾。
//
// 两个已知取舍写在代码里：`.gltf` 引用了外部 .bin/贴图时单文件加载不了（提前给准确
// 提示）；DRACO 压缩的模型需要额外解码器，暂不支持（把 loader 的原话翻成人话）。

import { formatBytes } from "@shared/utils";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { type PlyPhase, usePreviewPly } from "../hooks/usePreviewPly.ts";
import {
	gltfNeedsExternalFiles,
	MODEL_MAX_BYTES,
	modelFormatOf,
} from "../lib/model.ts";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** Uint8Array → 独立的 ArrayBuffer（three 的 loader 只认 ArrayBuffer，不认 SharedArrayBuffer 联合类型） */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

/** 相机取景留的余量（模型包围球外扩这个比例） */
const FRAMING_MARGIN = 1.35;
/** 初始机位方向（斜上方 3/4 视角，与大多数模型查看器一致） */
const CAMERA_DIR = [0.8, 0.6, 0.8] as const;

/** 把 loader 抛出来的英文原话翻成人话（改不动的错误也至少要说清是哪一类） */
function readableError(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	if (/DRACO/i.test(message))
		return "这个模型用了 DRACO 压缩，浏览器端需要额外的解码器，暂不支持（可用未压缩的模型）";
	if (/WebGL/i.test(message))
		return "当前浏览器不支持 WebGL2，无法渲染 3D 模型";
	if (/Unexpected token|JSON/i.test(message))
		return "模型文件损坏（不是合法的模型数据）";
	return `无法渲染这个模型：${message}`;
}

/**
 * 把字节渲染到画布上，返回清理函数。
 *
 * 相机与光照用保守的取值（three 官方 glTF 示例那套量级）；这里没法在浏览器里核对
 * 观感，所以宁可用保守值而不是"调得很亮"。
 */
async function renderModel(
	canvas: HTMLCanvasElement,
	box: HTMLElement,
	bytes: Uint8Array,
	format: "glb" | "gltf" | "stl" | "obj",
): Promise<{ dispose: () => void; note: string }> {
	const THREE = await import("three");
	const { OrbitControls } = await import(
		"three/addons/controls/OrbitControls.js"
	);

	// 按格式挑 loader。都用 `parse` 而不是 `load`：文件字节是我们自己带凭据取回来的，
	// 让 loader 再去 fetch 一次会绕开私密文件的鉴权头
	let object: import("three").Object3D;
	if (format === "glb" || format === "gltf") {
		const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
		const loader = new GLTFLoader();
		const source =
			format === "glb" ? toArrayBuffer(bytes) : new TextDecoder().decode(bytes);
		if (format === "gltf" && gltfNeedsExternalFiles(source as string))
			throw new Error(
				"这个 .gltf 引用了外部文件（.bin 或贴图），单文件预览不了；请导出为自包含的 .glb",
			);
		const gltf = await loader.parseAsync(source, "");
		object = gltf.scene;
	} else if (format === "stl") {
		const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
		const geometry = new STLLoader().parse(toArrayBuffer(bytes));
		object = new THREE.Mesh(
			geometry,
			new THREE.MeshStandardMaterial({
				color: 0xc9ccd4,
				metalness: 0.1,
				roughness: 0.8,
			}),
		);
		// STL 多来自 CAD（z 轴朝上），转到 three 的 y 轴朝上，观感才和别的查看器一致
		object.rotation.x = -Math.PI / 2;
	} else {
		const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
		object = new OBJLoader().parse(new TextDecoder().decode(bytes));
		// OBJ 没有配套 .mtl 时材质为空，给一个中性材质才看得见
		object.traverse((child) => {
			if ((child as import("three").Mesh).isMesh) {
				const mesh = child as import("three").Mesh;
				if (!mesh.material) {
					mesh.material = new THREE.MeshStandardMaterial({
						color: 0xc9ccd4,
						metalness: 0.1,
						roughness: 0.8,
					});
				}
			}
		});
	}

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x1a1a1e);
	scene.add(object);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 3));
	const key = new THREE.DirectionalLight(0xffffff, 3);
	key.position.set(1, 2, 1.5);
	scene.add(key);

	// 取景：按包围球把整个模型装进画面
	const bounds = new THREE.Box3().setFromObject(object);
	const center = bounds.getCenter(new THREE.Vector3());
	const radius = Math.max(
		bounds.getBoundingSphere(new THREE.Sphere()).radius,
		1e-3,
	);
	scene.add(new THREE.GridHelper(radius * 6, 12, 0x3a3a44, 0x2a2a32));

	const camera = new THREE.PerspectiveCamera(50, 1, radius / 100, radius * 100);
	const distance = (radius * FRAMING_MARGIN) / Math.sin((50 * Math.PI) / 360);
	camera.position
		.copy(center)
		.add(new THREE.Vector3(...CAMERA_DIR).normalize().multiplyScalar(distance));
	camera.lookAt(center);

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

	const controls = new OrbitControls(camera, canvas);
	controls.target.copy(center);
	controls.enableDamping = false; // 关掉阻尼 = 静止时不烧 GPU（按需重绘）
	controls.update();

	const render = () => {
		renderer.render(scene, camera);
	};
	// 按需重绘：只在交互/尺寸变化时画，空闲时这一页完全不占 GPU
	controls.addEventListener("change", render);
	render();

	const resize = () => {
		const width = Math.max(1, box.clientWidth);
		const height = Math.max(1, box.clientHeight);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		render();
	};
	const observer = new ResizeObserver(resize);
	observer.observe(box);
	resize();

	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		observer.disconnect();
		controls.dispose();
		scene.traverse((child) => {
			const mesh = child as import("three").Mesh;
			mesh.geometry?.dispose();
			const material = mesh.material;
			if (Array.isArray(material)) {
				// 一个网格可以挂多份材质（three 的类型就是 Mesh | Mesh[]）
				for (const m of material) m.dispose();
			} else {
				material?.dispose();
			}
		});
		renderer.dispose();
	};

	// 统计一下规模，让用户知道"看到的是什么"
	const meshes: import("three").Mesh[] = [];
	object.traverse((child) => {
		if ((child as import("three").Mesh).isMesh)
			meshes.push(child as import("three").Mesh);
	});
	const triangles = meshes.reduce((sum, mesh) => {
		const index = mesh.geometry?.index;
		const count =
			index?.count ??
			(mesh.geometry?.getAttribute("position")?.count as number | undefined) ??
			0;
		return sum + Math.floor(count / 3);
	}, 0);
	return {
		dispose,
		note: `${meshes.length} 个网格 · ${triangles.toLocaleString()} 个三角面`,
	};
}

/**
 * 3D 模型预览。画布挂载且字节到位后才懒加载 three 并渲染；
 * 卸载时把渲染器/几何/材质都释放掉（three 不会自己回收）。
 */
export const ModelViewer: ViewerComponent = (props) => {
	const [phase, setPhase] = createSignal<PlyPhase>();
	const load = usePreviewPly(() => props.item, MODEL_MAX_BYTES, setPhase);
	const [error, setError] = createSignal<string>();
	const [note, setNote] = createSignal<string>();
	const [stageEl, setStageEl] = createSignal<HTMLDivElement>();
	const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement>();

	createEffect(() => {
		const box = stageEl();
		const canvas = canvasEl();
		const state = load();
		if (!box || !canvas || state?.kind !== "ready") return;
		const format = modelFormatOf(props.item.original_name);
		if (!format) {
			setError(
				"这个文件名不是支持的 3D 模型格式（.glb / .gltf / .stl / .obj）",
			);
			return;
		}

		// 先登记清理再 await：await 之后再 onCleanup 就晚了（卸载可能已经发生）
		let cleanup: (() => void) | undefined;
		let cancelled = false;
		onCleanup(() => {
			cancelled = true;
			cleanup?.();
		});

		void (async () => {
			try {
				const result = await renderModel(canvas, box, state.bytes, format);
				if (cancelled) {
					result.dispose();
					return;
				}
				cleanup = result.dispose;
				setNote(result.note);
			} catch (err) {
				setError(readableError(err));
			}
		})();
	});

	const failure = () => {
		const state = load();
		if (state?.kind === "failed") return state.message;
		if (state?.kind === "too-large")
			return "文件超过 256 MB，浏览器端不加载；可下载后用本地工具查看";
		return undefined;
	};

	return (
		<div ref={setStageEl} class={styles.modelStage}>
			<canvas ref={setCanvasEl} class={styles.modelCanvas} />
			<Show when={error() ?? failure()}>
				{(message) => (
					<div class={styles.modelOverlay}>
						<p class={styles.modelMessage}>3D 模型预览不可用</p>
						<p class={styles.modelDetail}>{message()}</p>
						<p class={styles.modelDetail}>
							可以下载后用本地工具查看；拖拽可旋转、滚轮缩放。
						</p>
					</div>
				)}
			</Show>
			<Show when={!error() && !failure() && !note()}>
				<div class={styles.modelOverlay}>
					<p class={styles.modelMessage}>
						{phase()?.kind === "downloading"
							? `正在下载模型（${formatBytes((phase() as { sizeBytes: number }).sizeBytes)}）…`
							: "正在加载模型…"}
					</p>
				</div>
			</Show>
			<Show when={!error() && !failure() && note()}>
				{(text) => <p class={styles.modelHint}>{text()}</p>}
			</Show>
		</div>
	);
};

/** 供测试断言用：渲染函数本身不导出，这里只暴露错误翻译 */
export const __internal = { readableError };
