import { createEffect, createMemo } from "solid-js";
import { createSignal } from "solid-js";
import { For } from "solid-js/web";

// 弧度
class Angle {
    private _value: number;
    constructor(radian: number) {
        this._value = radian;
    }
    get degree(): number {
        return (this._value * 180) / Math.PI;
    }

    get radian(): number {
        return this._value;
    }
}

interface RainbowDrawerProps {
    colors: Array<string>;
    angle: Angle;
    squareSize?: number;
}

function RainbowDrawer(props: RainbowDrawerProps) {
    const colors = createMemo(() => props.colors);
    const squareSize = createMemo(() => props.squareSize ?? 200);
    const angle = createMemo(() => props.angle);
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
            <svg width={squareSize()} height={squareSize()}>
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

export { RainbowDrawer , Angle};
