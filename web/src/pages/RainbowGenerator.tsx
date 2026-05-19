import { createMemo } from "solid-js";
import { createSignal } from "solid-js";
import { RainbowDrawer } from "../components/RainbowDrawer.tsx";
import { Angle } from "../lib/angle.ts";
import { Color } from "../lib/color.ts";
import AngleEditor from "../components/AngleEditor.tsx";
import ColorEditor from "../components/ColorEditor.tsx";
import styles from "./RainbowGenerator.module.css";

function RainbowGenerator() {
    const L = 0.7;
    const C = 0.173;
    const h_offset = 29;

    const [colors, setColors] = createSignal<Color[]>([
        Color.fromOklch({L, C, h:h_offset}),
        Color.fromOklch({L, C, h:360/7 + h_offset}),
        Color.fromOklch({L, C, h:360/7*2 + h_offset}),
        Color.fromOklch({L, C, h:360/7*3 + h_offset}),
        Color.fromOklch({L, C, h:360/7*4 + h_offset}),
        Color.fromOklch({L, C, h:360/7*5 + h_offset}),
        Color.fromOklch({L, C, h:360/7*6 + h_offset}),
    ]);

    const squareSize = 10240;
    const exportSize = 400;

    const [angle, setAngle] = createSignal<Angle>(new Angle(Math.PI * (1 / 9)));

    type ShapeRender =
        | "auto"
        | "optimizeSpeed"
        | "crispEdges"
        | "geometricPrecision";
    const [shapeRender, setShapeRender] = createSignal<ShapeRender>(
        "geometricPrecision",
    );
    const RENDER_MODES: { key: ShapeRender; label: string }[] = [
        { key: "geometricPrecision", label: "精度" },
        { key: "auto", label: "自动" },
        { key: "crispEdges", label: "锐利" },
        { key: "optimizeSpeed", label: "速度" },
    ];

    let svgEl: SVGSVGElement | null = null;

    const height_sum = createMemo(
        () =>
            squareSize * (Math.sin(angle().radian) + Math.cos(angle().radian)),
    );
    const rectHeight = createMemo(() => height_sum() / colors().length);
    const rectWidth = createMemo(
        () =>
            squareSize / Math.cos(angle().radian) +
            2 * rectHeight() * Math.tan(angle().radian),
    );
    // ── 导出 ──

    const download = (url: string, filename: string) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportSvg = () => {
        if (!svgEl) return;
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        // 按实际内容大小导出（放大到 squareSize）
        clone.setAttribute("width", String(squareSize));
        clone.setAttribute("height", String(squareSize));
        const xml = new XMLSerializer().serializeToString(clone);
        const blob = new Blob(
            [`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`],
            { type: "image/svg+xml" },
        );
        download(URL.createObjectURL(blob), "rainbow.svg");
    };

    const exportPng = () => {
        if (!svgEl) return;
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        clone.setAttribute("width", String(squareSize));
        clone.setAttribute("height", String(squareSize));
        const xml = new XMLSerializer().serializeToString(clone);
        const dataUrl = `data:image/svg+xml;base64,${
            btoa(unescape(encodeURIComponent(xml)))
        }`;

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = squareSize;
            canvas.height = squareSize;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
                if (blob) download(URL.createObjectURL(blob), "rainbow.png");
            }, "image/png");
        };
        img.src = dataUrl;
    };

    return (
        <div class={styles.page}>
            <div class={styles.controls}>
                <AngleEditor angle={angle} setAngle={setAngle} />
                <ColorEditor colors={colors} setColors={setColors} />

                <div class={styles.exportRow}>
                    <button
                        type="button"
                        class={styles.exportBtn}
                        onClick={exportSvg}
                    >
                        导出 SVG
                    </button>
                    <button
                        type="button"
                        class={styles.exportBtn}
                        onClick={exportPng}
                    >
                        导出 PNG
                    </button>
                </div>

                <div class={styles.renderRow}>
                    <span class={styles.renderLabel}>渲染</span>
                    <div class={styles.segmented}>
                        {RENDER_MODES.map((m) => (
                            <button
                                type="button"
                                class={shapeRender() === m.key
                                    ? styles.segActive
                                    : styles.segBtn}
                                onClick={() => setShapeRender(m.key)}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>

                <section class={styles.stats}>
                    <h3>计算结果</h3>
                    <table>
                        <tbody>
                            <tr>
                                <td>色条宽度</td>
                                <td>{rectWidth().toFixed(1)} px</td>
                            </tr>
                            <tr>
                                <td>色条高度</td>
                                <td>{rectHeight().toFixed(1)} px</td>
                            </tr>
                            <tr>
                                <td>总高度</td>
                                <td>{height_sum().toFixed(1)} px</td>
                            </tr>
                            <tr>
                                <td>色条数</td>
                                <td>{colors().length}</td>
                            </tr>
                        </tbody>
                    </table>
                </section>
            </div>
            <div class={styles.preview}>
                <RainbowDrawer
                    colors={colors()}
                    angle={angle()}
                    squareSize={squareSize}
                    eleSize={exportSize}
                    svgRef={(el) => {
                        svgEl = el;
                    }}
                    shapeRendering={shapeRender()}
                />
            </div>
        </div>
    );
}

export default RainbowGenerator;
