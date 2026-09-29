import {
  createComponent,
  splitProps,
  useContext,
  type Component,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../../utils/cn";
import { Button as ButtonExternal, type ButtonProps } from "../button";
import { Tooltip, type KumoTooltipSide } from "../tooltip";
import type { KumoInputSize } from "../input";
import {
  deferInputGroupPart,
  INPUT_GROUP_SIZE,
  InputGroupAddonContext,
  useInputGroupContext,
} from "./context";

const COMPACT_BUTTON_SIZE: Record<KumoInputSize, KumoInputSize> = {
  xs: "xs",
  sm: "xs",
  base: "sm",
  lg: "base",
};

export type InputGroupButtonProps = ButtonProps & {
  tooltip?: JSX.Element;
  tooltipSide?: KumoTooltipSide;
};

export function Button(inputProps: InputGroupButtonProps) {
  const [props, buttonProps] = splitProps(inputProps, [
    "children",
    "className",
    "variant",
    "size",
    "disabled",
    "tooltip",
    "tooltipSide",
    "icon",
    "ref",
    "aria-label",
  ]);
  const part = {
    kind: "button" as const,
    get variant() {
      return props.variant ?? "ghost";
    },
  };

  return deferInputGroupPart(() => {
    const context = useInputGroupContext("Button");
    const isInsideAddon = useContext(InputGroupAddonContext);
    const isIndividual = () =>
      !isInsideAddon &&
      (context?.focusMode === "individual" || context?.focusMode === "hybrid");
    const isDisabled = () => props.disabled ?? context?.disabled;
    const effectiveVariant = () => props.variant ?? "ghost";

    if (
      import.meta.env?.DEV &&
      context &&
      effectiveVariant() === "ghost" &&
      !isInsideAddon
    ) {
      console.warn(
        "InputGroup.Button: Ghost buttons should be wrapped in <InputGroup.Addon> for correct spacing.",
      );
    }
    if (import.meta.env?.DEV && context && props.size !== undefined) {
      console.warn(
        "InputGroup.Button: Set `size` on <InputGroup> instead of <InputGroup.Button>.",
      );
    }

    const tooltipAriaLabel = () =>
      typeof props.tooltip === "string" && !props["aria-label"]
        ? props.tooltip
        : undefined;
    const contextIconSize = () =>
      context ? INPUT_GROUP_SIZE[context.size].iconSize : undefined;
    const sizedIcon = () => {
      const icon = props.icon;
      const iconSize = contextIconSize();
      if (typeof icon !== "function" || iconSize === undefined) return icon;

      const Icon = icon as Component<{ size?: number }>;
      const SizedIcon: Component = (iconProps) => (
        <Dynamic component={Icon} {...iconProps} size={iconSize} />
      );
      return SizedIcon;
    };
    const effectiveSize = () =>
      props.size ??
      (isIndividual()
        ? (context?.size ?? "sm")
        : COMPACT_BUTTON_SIZE[context?.size ?? "base"]);

    const button = () =>
      createComponent(ButtonExternal as Component<Record<string, unknown>>, {
        ...buttonProps,
        get ref() {
          return props.ref;
        },
        type: "button",
        get disabled() {
          return isDisabled();
        },
        get "aria-label"() {
          return props["aria-label"] ?? tooltipAriaLabel();
        },
        get icon() {
          return sizedIcon();
        },
        get variant() {
          return effectiveVariant();
        },
        get size() {
          return effectiveSize();
        },
        get className() {
          return cn(
            "pointer-events-auto",
            "shadow-none",
            "focus:ring-0",
            !isIndividual() &&
              "focus-visible:ring-[1.5px] focus-visible:ring-kumo-focus/50",
            isIndividual() && [
              "relative h-full! rounded-none border border-kumo-line ring-0 focus-visible:ring-0",
              "first:rounded-l-[inherit] last:rounded-r-[inherit]",
              "not-first:-ml-px",
              "hover:z-1",
              "focus:z-2",
              "focus-visible:border-kumo-focus/50",
              "disabled:bg-kumo-overlay disabled:text-kumo-inactive!",
            ],
            props.className,
          );
        },
        get children() {
          return props.children;
        },
      });

    if (!props.tooltip) return button();

    return (
      <Tooltip
        content={props.tooltip}
        side={props.tooltipSide ?? "bottom"}
        render={(triggerProps) => (
          <span
            {...(triggerProps as JSX.HTMLAttributes<HTMLSpanElement>)}
            class={cn(
              "inline-flex",
              (triggerProps as JSX.HTMLAttributes<HTMLSpanElement>).class,
            )}
          >
            {button()}
          </span>
        )}
      />
    );
  }, part);
}
