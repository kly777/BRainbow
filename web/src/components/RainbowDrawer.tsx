import { createMemo } from "solid-js";
import { For } from "solid-js/web";
import type { Angle } from "../lib/angle.ts";
import type { Color } from "../lib/color.ts";

type ShapeRender =
    | "auto"
    | "optimizeSpeed"
    | "crispEdges"
    | "geometricPrecision";

interface RainbowDrawerProps {
    colors: Array<Color>;
    angle: Angle;
    squareSize?: number;
    eleSize?: number;
    svgRef?: (el: SVGSVGElement) => void;
    shapeRendering?: ShapeRender;
}

function RainbowDrawer(props: RainbowDrawerProps) {
    const size = () => props.squareSize ?? 200;
    const eleSize = () => props.eleSize ?? size();
    const height_sum = createMemo(
        () =>
            size() *
            (Math.sin(props.angle.radian) + Math.cos(props.angle.radian)),
    );
    const rectHeight = createMemo(() => height_sum() / props.colors.length);
    const rectWidth = createMemo(
        () =>
            size() / Math.cos(props.angle.radian) +
            2 * rectHeight() * Math.tan(props.angle.radian),
    );
    const y_offset = createMemo(() =>
        rectHeight() / Math.cos(props.angle.radian)
    );

    /** 预计算每条色带旋转+平移后的多边形顶点，消除 runtime transform */
    const stripePolygons = createMemo(() => {
        const deg = props.angle.radian;
        const cos = Math.cos(deg);
        const sin = Math.sin(deg);
        const tan = Math.tan(deg);
        const rh = rectHeight();
        const rw = rectWidth();
        const yo = y_offset();
        const xOff = tan * rh;

        return props.colors.map((_, i) => {
            const yBase = yo * i;
            const ax = -xOff * cos;
            const ay = yBase + xOff * sin;
            const bx = (rw - xOff) * cos;
            const by = yBase - (rw - xOff) * sin;
            const cx = (rw - xOff) * cos + rh * sin;
            const cy = yBase - (rw - xOff) * sin + rh * cos;
            const dx = -xOff * cos + rh * sin;
            const dy = yBase + xOff * sin + rh * cos;
            return {
                points: `${ax},${ay} ${bx},${by} ${cx},${cy} ${dx},${dy}`,
            };
        });
    });

    return (
        <div>
            <svg
                ref={props.svgRef}
                width={eleSize()}
                height={eleSize()}
                viewBox={`0 0 ${size()} ${size()}`}
                shape-rendering={props.shapeRendering ?? "geometricPrecision"}
            >
                <title>Rainbow</title>
                <For each={stripePolygons()}>
                    {({ points }, index) => (
                        <polygon points={points} fill={props.colors[index()].toHex()} />
                    )}
                </For>
            </svg>
        </div>
    );
}

export { RainbowDrawer };
