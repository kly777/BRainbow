import { createMemo, createUniqueId, Show, type JSX } from "solid-js";
import { cn } from "../../utils/cn";

function seededUnit(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function seededInteger(seed: string, min: number, max: number) {
  return Math.floor(seededUnit(seed) * (max - min + 1) + min);
}

function seededFloat(seed: string, min: number, max: number) {
  return (seededUnit(seed) * (max - min) + min).toFixed(2);
}

export interface SkeletonLineProps {
  minWidth?: number;
  maxWidth?: number;
  minDuration?: number;
  maxDuration?: number;
  minDelay?: number;
  maxDelay?: number;
  blockHeight?: string | number;
  className?: string;
}

export function SkeletonLine(props: SkeletonLineProps) {
  const id = createUniqueId();
  const values = createMemo(() => {
    const minWidth = props.minWidth ?? 30;
    const maxWidth = props.maxWidth ?? 100;
    const minDuration = props.minDuration ?? 1.3;
    const maxDuration = props.maxDuration ?? 1.7;
    const minDelay = props.minDelay ?? 0;
    const maxDelay = props.maxDelay ?? 0.5;
    const ranges = [
      minWidth,
      maxWidth,
      minDuration,
      maxDuration,
      minDelay,
      maxDelay,
    ].join(":");

    return {
      width: seededInteger(`${id}:width:${ranges}`, minWidth, maxWidth),
      duration: seededFloat(
        `${id}:duration:${ranges}`,
        minDuration,
        maxDuration,
      ),
      delay: seededFloat(`${id}:delay:${ranges}`, minDelay, maxDelay),
    };
  });
  const lineStyle = createMemo(
    () =>
      ({
        "--skeleton-width": `${values().width}%`,
        "--shimmer-duration": `${values().duration}s`,
        "--shimmer-delay": `${values().delay}s`,
      }) as JSX.CSSProperties,
  );
  const line = () => (
    <div class={cn("skeleton-line", props.className)} style={lineStyle()} />
  );
  const height = () => {
    const value = props.blockHeight;
    return typeof value === "number" ? `${value}px` : value;
  };

  return (
    <Show when={props.blockHeight !== undefined} fallback={line()}>
      <div class="flex items-center" style={{ height: height() }}>
        {line()}
      </div>
    </Show>
  );
}
