import { Button, FilterGroup } from "@components/ui";
import type { Component } from "solid-js";
import AngleEditor from "./AngleEditor";
import ColorEditor from "./ColorEditor";
import { useRainbowGenerator } from "./hooks/useRainbowGenerator.ts";
import { RAINBOW_SQUARE_SIZE } from "./lib/geometry.ts";
import { RainbowDrawer, type ShapeRender } from "./RainbowDrawer";
import styles from "./RainbowGenerator.module.css";

const StatsSection: Component<{
	rectWidth: number;
	rectHeight: number;
	heightSum: number;
	colorCount: number;
}> = (props) => (
	<section class={styles.stats}>
		<h3>计算结果</h3>
		<table>
			<tbody>
				<tr>
					<td>色条宽度</td>
					<td>{props.rectWidth.toFixed(1)} px</td>
				</tr>
				<tr>
					<td>色条高度</td>
					<td>{props.rectHeight.toFixed(1)} px</td>
				</tr>
				<tr>
					<td>总高度</td>
					<td>{props.heightSum.toFixed(1)} px</td>
				</tr>
				<tr>
					<td>色条数</td>
					<td>{props.colorCount}</td>
				</tr>
			</tbody>
		</table>
	</section>
);

const RENDER_MODES = [
	{ value: "geometricPrecision" as const, label: "精度" },
	{ value: "auto" as const, label: "自动" },
	{ value: "crispEdges" as const, label: "锐利" },
	{ value: "optimizeSpeed" as const, label: "速度" },
];

function RainbowGenerator() {
	const m = useRainbowGenerator();
	const exportSize = 400;

	return (
		<div class={styles.page}>
			{/* 页面唯一的一级标题：本页标题已由界面元素 / 标签页呈现，故用 sr-only 补齐 document outline 与读屏器按标题导航 */}
			<h1 class="sr-only">彩虹生成器</h1>
			<div class={styles.controls}>
				<AngleEditor angle={m.angle} setAngle={m.setAngle} />
				<ColorEditor colors={m.colors} setColors={m.setColors} />

				<div class={styles.exportBtns}>
					<Button variant="secondary" size="sm" onClick={m.exportSvg}>
						导出 SVG
					</Button>
					<Button variant="secondary" size="sm" onClick={m.exportPng}>
						导出 PNG
					</Button>
				</div>

				<div class={styles.renderMode}>
					<span class={styles.renderLabel}>渲染模式</span>
					<FilterGroup
						options={RENDER_MODES}
						selected={m.shapeRender()}
						onChange={(v) => m.setShapeRender(v as ShapeRender)}
					/>
				</div>

				<StatsSection
					rectWidth={m.rectWidth()}
					rectHeight={m.rectHeight()}
					heightSum={m.heightSum()}
					colorCount={m.colors().length}
				/>
			</div>
			<div class={styles.preview}>
				<RainbowDrawer
					colors={m.colors()}
					angle={m.angle()}
					squareSize={RAINBOW_SQUARE_SIZE}
					eleSize={exportSize}
					svgRef={m.bindSvg}
					shapeRendering={m.shapeRender()}
				/>
			</div>
		</div>
	);
}

export default RainbowGenerator;
