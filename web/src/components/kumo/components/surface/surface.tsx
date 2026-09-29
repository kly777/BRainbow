import { splitProps, type ValidComponent } from "solid-js";
import { useRender } from "@photon-ai/base-ui-solid/use-render";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";
import { LayerCard, type LayerCardProps } from "../layer-card";

export const KUMO_SURFACE_VARIANTS = {
  color: {
    primary: {
      classes: "",
      description: "Primary surface color",
    },
    secondary: {
      classes: "",
      description: "Secondary surface color",
    },
  },
} as const;

export const KUMO_SURFACE_DEFAULT_VARIANTS = {
  color: "primary",
} as const;

export type KumoSurfaceColor = keyof typeof KUMO_SURFACE_VARIANTS.color;

export interface KumoSurfaceVariantsProps {
  color?: KumoSurfaceColor;
}

export function surfaceVariants({
  color = KUMO_SURFACE_DEFAULT_VARIANTS.color,
}: KumoSurfaceVariantsProps = {}) {
  return resolveVariant(
    KUMO_SURFACE_VARIANTS.color,
    color,
    KUMO_SURFACE_DEFAULT_VARIANTS.color,
  ).classes;
}

export type SurfaceProps = LayerCardProps &
  KumoSurfaceVariantsProps & {
    /** @deprecated Use the Solid `render` prop instead. */
    as?: ValidComponent;
  };

export function Surface(inputProps: SurfaceProps) {
  const [props, layerCardProps] = splitProps(inputProps, [
    "color",
    "class",
    "className",
    "render",
    "as",
  ]);
  const color = () => props.color ?? KUMO_SURFACE_DEFAULT_VARIANTS.color;
  const resolvedRender = () => {
    if (props.render !== undefined) return props.render;
    if (props.as === undefined) return undefined;
    if (typeof props.as === "string") {
      return props.as as useRender.RenderProp;
    }
    return { component: props.as } as useRender.RenderProp;
  };

  return (
    <LayerCard
      {...layerCardProps}
      class={cn("overflow-visible rounded-none", props.class, props.className)}
      render={resolvedRender()}
      data-surface-color={color()}
      data-deprecated="surface"
    />
  );
}
