import { createMemo } from "solid-js";
import { resolveVariant } from "../../utils/resolve-variant";

export const KUMO_LOADER_VARIANTS = {
  size: {
    sm: {
      value: 16,
      description: "Small loader for inline use",
    },
    base: {
      value: 24,
      description: "Default loader size",
    },
    lg: {
      value: 32,
      description: "Large loader for prominent loading states",
    },
  },
} as const;

export const KUMO_LOADER_DEFAULT_VARIANTS = {
  size: "base",
} as const;

export type KumoLoaderSize = keyof typeof KUMO_LOADER_VARIANTS.size;

export interface KumoLoaderVariantsProps {
  size?: KumoLoaderSize | number;
}

export function loaderVariants({
  size = KUMO_LOADER_DEFAULT_VARIANTS.size,
}: KumoLoaderVariantsProps = {}): number {
  if (typeof size === "number") return size;
  return resolveVariant(
    KUMO_LOADER_VARIANTS.size,
    size,
    KUMO_LOADER_DEFAULT_VARIANTS.size,
  ).value;
}

export interface LoaderProps {
  className?: string;
  size?: KumoLoaderSize | number;
  "aria-label"?: string;
}

export function Loader(props: LoaderProps) {
  const size = createMemo(() =>
    loaderVariants({
      size: props.size ?? KUMO_LOADER_DEFAULT_VARIANTS.size,
    }),
  );

  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      class={props.className}
      style={{ height: `${size()}px`, width: `${size()}px` }}
      role="status"
      aria-label={props["aria-label"] ?? "Loading"}
    >
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="stroke-dasharray"
          values="0 150;42 150;42 150"
          keyTimes="0;0.5;1"
          dur="1.5s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="stroke-dashoffset"
          values="0;-16;-59"
          keyTimes="0;0.5;1"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        opacity="0.1"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}
