import { createMemo, mergeProps, Show, type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";

export const KUMO_BADGE_BASE_STYLES =
  "inline-flex w-fit flex-none shrink-0 items-center justify-self-start rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export const KUMO_BADGE_VARIANTS = {
  variant: {
    primary: {
      classes: "bg-kumo-badge-inverted text-kumo-badge-inverted",
      description: "Primary badge",
    },
    secondary: {
      classes: "bg-kumo-fill text-kumo-badge-neutral-subtle",
      description: "Secondary badge",
    },
    error: {
      classes: "bg-kumo-danger-tint text-kumo-danger",
      description: "Error badge",
    },
    warning: {
      classes: "bg-kumo-warning-tint text-kumo-warning",
      description: "Warning badge",
    },
    success: {
      classes: "bg-kumo-success-tint text-kumo-success",
      description: "Success badge",
    },
    destructive: {
      classes: "bg-kumo-badge-red text-white",
      description: "Deprecated. Use red instead.",
    },
    info: {
      classes: "bg-kumo-info-tint text-kumo-info",
      description: "Info badge",
    },
    beta: {
      classes:
        "border border-dashed border-kumo-brand bg-transparent text-kumo-link",
      description: "Indicates beta or experimental features",
    },
    outline: {
      classes: "border border-kumo-fill bg-transparent text-kumo-default",
      description: "Bordered badge with transparent background",
    },
    red: {
      classes: "bg-kumo-badge-red text-white",
      description: "Red badge",
    },
    green: {
      classes: "bg-kumo-badge-green text-white",
      description: "Green badge",
    },
    neutral: {
      classes: "bg-kumo-badge-neutral text-white",
      description: "Neutral badge",
    },
    orange: {
      classes: "bg-kumo-badge-orange text-black",
      description: "Orange badge",
    },
    purple: {
      classes: "bg-kumo-badge-purple text-white",
      description: "Purple badge",
    },
    teal: {
      classes: "bg-kumo-badge-teal text-white",
      description: "Teal badge",
    },
    "teal-subtle": {
      classes: "bg-kumo-badge-teal-subtle text-kumo-badge-teal-subtle",
      description: "Subtle teal badge",
    },
    blue: {
      classes: "bg-kumo-badge-blue text-white",
      description: "Blue badge",
    },
  },
  appearance: {
    filled: {
      classes: "",
      description: "Filled badge with background color (default)",
    },
    dot: {
      classes:
        "gap-1.5 bg-transparent text-kumo-default ring ring-kumo-hairline",
      description: "Outlined badge with a colored circle dot indicating status",
    },
  },
  dotColor: {
    none: {
      classes: "",
      description:
        "No dot indicator (used when appearance is not dot, or variant has no dot color)",
    },
    success: {
      classes: "bg-kumo-success",
      description: "Green dot for success status",
    },
    warning: {
      classes: "bg-kumo-badge-orange",
      description: "Orange dot for warning status",
    },
    error: {
      classes: "bg-kumo-badge-red",
      description: "Red dot for error status",
    },
    neutral: {
      classes: "bg-kumo-badge-neutral",
      description: "Neutral dot for informational status",
    },
  },
} as const;

export const KUMO_BADGE_DEFAULT_VARIANTS = {
  variant: "primary",
  appearance: "filled",
  dotColor: "none",
} as const;

export type KumoBadgeVariant = keyof typeof KUMO_BADGE_VARIANTS.variant;
export type KumoBadgeAppearance = keyof typeof KUMO_BADGE_VARIANTS.appearance;
export type BadgeVariant = KumoBadgeVariant;

export interface KumoBadgeVariantsProps {
  variant?: KumoBadgeVariant;
  appearance?: KumoBadgeAppearance;
}

export function badgeVariants({
  variant = KUMO_BADGE_DEFAULT_VARIANTS.variant,
  appearance = KUMO_BADGE_DEFAULT_VARIANTS.appearance,
}: KumoBadgeVariantsProps = {}) {
  const variantClasses = resolveVariant(
    KUMO_BADGE_VARIANTS.variant,
    variant,
    KUMO_BADGE_DEFAULT_VARIANTS.variant,
  ).classes;
  const appearanceClasses = resolveVariant(
    KUMO_BADGE_VARIANTS.appearance,
    appearance,
    KUMO_BADGE_DEFAULT_VARIANTS.appearance,
  ).classes;

  return cn(
    KUMO_BADGE_BASE_STYLES,
    appearance === "dot" ? "" : variantClasses,
    appearanceClasses,
  );
}

export interface BadgeProps {
  variant?: KumoBadgeVariant;
  appearance?: KumoBadgeAppearance;
  className?: string;
  children: JSX.Element;
}

export function Badge(inputProps: BadgeProps) {
  const props = mergeProps(
    {
      variant: KUMO_BADGE_DEFAULT_VARIANTS.variant as KumoBadgeVariant,
      appearance: KUMO_BADGE_DEFAULT_VARIANTS.appearance as KumoBadgeAppearance,
    },
    inputProps,
  );

  const dotColor = createMemo(() =>
    props.appearance === "dot"
      ? resolveVariant(
          KUMO_BADGE_VARIANTS.dotColor,
          props.variant,
          KUMO_BADGE_DEFAULT_VARIANTS.dotColor,
        ).classes
      : "",
  );

  return (
    <span
      class={cn(
        badgeVariants({
          variant: props.variant,
          appearance: props.appearance,
        }),
        props.className,
      )}
    >
      <Show when={dotColor()}>
        {(color) => (
          <span
            aria-hidden="true"
            class={cn("size-1.75 shrink-0 rounded-full", color())}
          />
        )}
      </Show>
      {props.children}
    </span>
  );
}
