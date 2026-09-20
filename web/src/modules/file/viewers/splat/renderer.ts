// ── 高斯泼溅的 WebGL2 渲染器（不含 UI 与交互） ──
//
// 与参考实现 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）的
// 差异：不跑常驻 rAF 循环，改为"按需重绘"（相机变化/排序结果到达/尺寸变化才画），
// 免得一个预览页在后台持续烧 GPU。渲染状态、混合函数、实例化绘制与参考一致。

import { SPLAT_FOV_DEG } from "./fit.ts";
import { focalForFov, type Mat4, projectionMatrix } from "./matrix.ts";
import { SPLAT_FRAGMENT_SHADER, SPLAT_VERTEX_SHADER } from "./shaders.ts";

export interface SplatRenderer {
	/** 视口尺寸（CSS 像素）；内部会乘 devicePixelRatio 到设备像素 */
	resize(width: number, height: number): void;
	/** 上传顶点纹理（worker 算好的 RGBA32UI 数据） */
	setSplatTexture(
		texdata: Uint32Array,
		texWidth: number,
		texHeight: number,
	): void;
	/** 上传深度排序后的索引 */
	setDepthIndex(depthIndex: Uint32Array): void;
	/** 画一帧 */
	draw(view: Mat4, vertexCount: number): void;
	dispose(): void;
}

function compile(
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("无法创建着色器");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? "未知错误";
		gl.deleteShader(shader);
		throw new Error(`着色器编译失败：${log}`);
	}
	return shader;
}

/** 创建渲染器；WebGL2 不可用时抛错（调用方负责给出降级提示） */
export function createSplatRenderer(canvas: HTMLCanvasElement): SplatRenderer {
	const gl = canvas.getContext("webgl2", {
		antialias: false,
		// 顶点数据是预乘形式（rgb 已乘不透明度），交给浏览器与页面背景合成
		premultipliedAlpha: true,
	});
	if (!gl) throw new Error("当前浏览器不支持 WebGL2");

	const vertexShader = compile(gl, gl.VERTEX_SHADER, SPLAT_VERTEX_SHADER);
	const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, SPLAT_FRAGMENT_SHADER);
	const program = gl.createProgram();
	if (!program) throw new Error("无法创建着色器程序");
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? "未知错误";
		throw new Error(`着色器链接失败：${log}`);
	}
	gl.useProgram(program);

	// 不做深度测试：顺序由深度排序 + 反向 alpha 混合决定
	gl.disable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFuncSeparate(
		gl.ONE_MINUS_DST_ALPHA,
		gl.ONE,
		gl.ONE_MINUS_DST_ALPHA,
		gl.ONE,
	);
	gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
	gl.clearColor(0, 0, 0, 0);

	const uProjection = gl.getUniformLocation(program, "projection");
	const uView = gl.getUniformLocation(program, "view");
	const uFocal = gl.getUniformLocation(program, "focal");
	const uViewport = gl.getUniformLocation(program, "viewport");
	const uTexture = gl.getUniformLocation(program, "u_texture");
	gl.uniform1i(uTexture, 0);

	// 实例化的四边形（-2..2）：着色器把它按椭圆主轴/副轴缩放
	const quad = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quad);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]),
		gl.STATIC_DRAW,
	);
	const aPosition = gl.getAttribLocation(program, "position");
	gl.enableVertexAttribArray(aPosition);
	gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

	// 每实例一个索引（整数属性，不能用 vertexAttribPointer）
	const indexBuffer = gl.createBuffer();
	const aIndex = gl.getAttribLocation(program, "index");
	gl.enableVertexAttribArray(aIndex);
	gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
	gl.vertexAttribIPointer(aIndex, 1, gl.INT, 0, 0);
	gl.vertexAttribDivisor(aIndex, 1);

	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

	let width = 1;
	let height = 1;
	let disposed = false;

	return {
		resize(nextWidth, nextHeight) {
			if (disposed) return;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			width = Math.max(1, Math.round(nextWidth));
			height = Math.max(1, Math.round(nextHeight));
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(height * dpr);
			gl.viewport(0, 0, canvas.width, canvas.height);
			// focal 与 viewport 用 CSS 像素：着色器按它们把椭圆尺寸换算成 NDC
			const focal = focalForFov(height, SPLAT_FOV_DEG);
			gl.uniform2fv(uFocal, new Float32Array([focal, focal]));
			gl.uniform2fv(uViewport, new Float32Array([width, height]));
			gl.uniformMatrix4fv(
				uProjection,
				false,
				projectionMatrix(focal, focal, width, height),
			);
		},

		setSplatTexture(texdata, texWidth, texHeight) {
			if (disposed) return;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA32UI,
				texWidth,
				texHeight,
				0,
				gl.RGBA_INTEGER,
				gl.UNSIGNED_INT,
				texdata,
			);
		},

		setDepthIndex(depthIndex) {
			if (disposed) return;
			gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, depthIndex, gl.DYNAMIC_DRAW);
		},

		draw(view, vertexCount) {
			if (disposed) return;
			gl.clear(gl.COLOR_BUFFER_BIT);
			if (vertexCount <= 0) return;
			gl.useProgram(program);
			gl.uniformMatrix4fv(uView, false, view);
			gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount);
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			gl.deleteBuffer(quad);
			gl.deleteBuffer(indexBuffer);
			gl.deleteTexture(texture);
			gl.deleteProgram(program);
			gl.deleteShader(vertexShader);
			gl.deleteShader(fragmentShader);
		},
	};
}
