import { createEffect, createMemo } from "solid-js";
import { For } from "solid-js/web";
import { Angle } from "../lib/angle.ts";

interface RainbowDrawerProps {
    colors: Array<string>;
    angle: Angle;
    squareSize?: number;
    eleSize?: number;
}

function RainbowDrawer(props: RainbowDrawerProps) {
    const colors = createMemo(() => props.colors);
    const squareSize = createMemo(() => props.squareSize ?? 200);
    const angle = createMemo(() => props.angle);
    const eleSize = createMemo(() => props.eleSize ?? squareSize());
    const height_sum = createMemo(
        () =>
            squareSize() * (Math.sin(angle().radian) + Math.cos(angle().radian)),
    );
    const rectHeight = createMemo(() => height_sum() / colors().length);
    const rectWidth = createMemo(
        () =>
            squareSize() / Math.cos(angle().radian) +
            2 * rectHeight() * Math.tan(angle().radian),
    );
    const y_offset = createMemo(() => rectHeight() / Math.cos(angle().radian));

    createEffect(() => {
        console.log(colors());
    });

    return (
        <div>
            <svg width={eleSize()} height={eleSize()} viewBox={`0 0 ${squareSize()} ${squareSize()}`} shape-rendering="crispEdges">
                <For each={colors()}>
                    {(color, index) => (
                        <rect
                            width={rectWidth().toString()}
                            height={rectHeight().toString()}
                            y={(y_offset() * index()).toString()}
                            fill={color}
                            transform={`
                                rotate(${-angle().degree} 0  ${(y_offset() * index()).toString()} )
                                translate(${-Math.tan(angle().radian) * rectHeight()})
                            `}
                        />
                    )}
                </For>
            </svg>
        </div>
    );
}

export { RainbowDrawer };
