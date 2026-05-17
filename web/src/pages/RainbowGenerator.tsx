import { createEffect, createMemo } from "solid-js";
import { createSignal } from "solid-js";
import { For } from "solid-js/web";
import {RainbowDrawer,Angle} from "../components/RainbowDrawer.tsx";

function RainbowGenerator() {
    const [colors, setColors] = createSignal<Array<string>>([
        "#00ff00",
        "#ff0000",
        "#0000ff",
    ]);

    const squareSize = 200;

    const [angle, setAngle] = createSignal<Angle>(new Angle(Math.PI * (1 / 9)));

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
    const y_offset = createMemo(() => rectHeight() / Math.cos(angle().radian));

    createEffect(() => {
        console.log(colors());
    });

    return (
        <RainbowDrawer colors={colors()} angle={angle()} squareSize={squareSize} />
    );
}

export default RainbowGenerator;
