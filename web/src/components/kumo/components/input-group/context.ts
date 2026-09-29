import { createContext, useContext, type JSX } from "solid-js";
import type { FieldProps } from "../field";
import type { KumoInputSize } from "../input";

export interface InputGroupSizeTokens {
  inputOuter: string;
  addonOuterStart: string;
  addonOuterEnd: string;
  addonButtonOuterStart: string;
  addonButtonOuterEnd: string;
  suffixPad: string;
  fontSize: string;
  iconClass: string;
  iconSize: number;
}

export const INPUT_GROUP_SIZE: Record<KumoInputSize, InputGroupSizeTokens> = {
  xs: {
    inputOuter: "px-1.5",
    addonOuterStart: "pl-1.5",
    addonOuterEnd: "pr-1.5",
    addonButtonOuterStart: "pl-1",
    addonButtonOuterEnd: "pr-1",
    suffixPad: "pr-1.5",
    fontSize: "text-xs",
    iconClass: "[&_svg]:size-[10px]",
    iconSize: 10,
  },
  sm: {
    inputOuter: "px-2",
    addonOuterStart: "pl-1.5",
    addonOuterEnd: "pr-1.5",
    addonButtonOuterStart: "pl-1",
    addonButtonOuterEnd: "pr-1",
    suffixPad: "pr-2",
    fontSize: "text-xs",
    iconClass: "[&_svg]:size-[13px]",
    iconSize: 13,
  },
  base: {
    inputOuter: "px-3",
    addonOuterStart: "pl-2",
    addonOuterEnd: "pr-2",
    addonButtonOuterStart: "pl-1",
    addonButtonOuterEnd: "pr-1",
    suffixPad: "pr-3",
    fontSize: "text-base",
    iconClass: "[&_svg]:size-[18px]",
    iconSize: 18,
  },
  lg: {
    inputOuter: "px-4",
    addonOuterStart: "pl-2.5",
    addonOuterEnd: "pr-2.5",
    addonButtonOuterStart: "pl-1.5",
    addonButtonOuterEnd: "pr-1.5",
    suffixPad: "pr-4",
    fontSize: "text-base",
    iconClass: "[&_svg]:size-[20px]",
    iconSize: 20,
  },
};

export const INPUT_GROUP_HAS_CLASSES: Record<KumoInputSize, string> = {
  xs: [
    "has-[[data-slot=input-group-addon-start]]:[&_input]:pl-1",
    "has-[[data-slot=input-group-addon-end]]:[&_input]:pr-1",
  ].join(" "),
  sm: [
    "has-[[data-slot=input-group-addon-start]]:[&_input]:pl-1.5",
    "has-[[data-slot=input-group-addon-end]]:[&_input]:pr-1.5",
  ].join(" "),
  base: [
    "has-[[data-slot=input-group-addon-start]]:[&_input]:pl-2",
    "has-[[data-slot=input-group-addon-end]]:[&_input]:pr-2",
  ].join(" "),
  lg: [
    "has-[[data-slot=input-group-addon-start]]:[&_input]:pl-2.5",
    "has-[[data-slot=input-group-addon-end]]:[&_input]:pr-2.5",
  ].join(" "),
};

export type InputGroupFocusMode = "container" | "individual" | "hybrid";

export interface InputGroupRootPropsInternal extends Omit<
  JSX.HTMLAttributes<HTMLElement>,
  "children" | "class" | "className"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
  description?: JSX.Element;
  disabled?: boolean;
  error?: FieldProps["error"];
  label?: JSX.Element;
  labelTooltip?: JSX.Element;
  required?: boolean;
  size?: KumoInputSize;
}

export type InputGroupRootProps = InputGroupRootPropsInternal;

export interface InputGroupContextValue {
  readonly size: KumoInputSize;
  readonly focusMode: InputGroupFocusMode;
  readonly disabled: boolean;
  readonly error: FieldProps["error"] | undefined;
  readonly inputId: string;
  readonly label: JSX.Element;
}

export const InputGroupContext = createContext<InputGroupContextValue | null>(
  null,
);
export const InputGroupAddonContext = createContext(false);

/**
 * Internal bridge used by compound controls, such as Toolbar.InputGroup, that
 * need the group's native input to participate in another Base UI composite.
 */
export interface InputGroupToolbarContextValue {
  readonly ariaLabel: string | undefined;
  readonly ariaLabelledBy: string | undefined;
}

export const InputGroupToolbarContext =
  createContext<InputGroupToolbarContextValue | null>(null);

export function useInputGroupContext(componentName: string) {
  const context = useContext(InputGroupContext);
  if (import.meta.env?.DEV && !context) {
    console.warn(
      `<InputGroup.${componentName}> must be used within <InputGroup>. Falling back to default values.`,
    );
  }
  return context;
}

const INPUT_GROUP_PART = Symbol("kumo.input-group.part");

export type InputGroupPart =
  | { readonly kind: "addon" | "input" | "suffix" }
  | { readonly kind: "button"; readonly variant: string };

type MarkedInputGroupPart = {
  [INPUT_GROUP_PART]?: InputGroupPart;
};

export function markInputGroupPart<T>(value: T, part: InputGroupPart): T {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    Object.defineProperty(value, INPUT_GROUP_PART, {
      configurable: true,
      value: part,
    });
  }
  return value;
}

export function deferInputGroupPart(
  render: () => JSX.Element,
  part: InputGroupPart,
): JSX.Element {
  return markInputGroupPart(render, part) as unknown as JSX.Element;
}

function getInputGroupPart(value: unknown) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    return (value as MarkedInputGroupPart)[INPUT_GROUP_PART];
  }
  return undefined;
}

function visitDirectChildren(
  value: unknown,
  visitor: (part: InputGroupPart | undefined, value: unknown) => void,
) {
  const part = getInputGroupPart(value);
  if (part) {
    visitor(part, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) visitDirectChildren(child, visitor);
    return;
  }
  if (typeof value === "function") {
    visitDirectChildren(value(), visitor);
    return;
  }
  visitor(undefined, value);
}

export function detectFocusMode(children: unknown): InputGroupFocusMode {
  let hasAddon = false;
  let hasNonGhostDirectButton = false;

  visitDirectChildren(children, (part) => {
    if (part?.kind === "addon") hasAddon = true;
    if (part?.kind === "button" && part.variant !== "ghost") {
      hasNonGhostDirectButton = true;
    }
  });

  if (hasAddon && hasNonGhostDirectButton) return "hybrid";
  if (hasNonGhostDirectButton) return "individual";
  return "container";
}

export function partitionChildren(children: unknown): {
  containerZone: JSX.Element[];
  individualZone: JSX.Element[];
} {
  const containerZone: JSX.Element[] = [];
  const individualZone: JSX.Element[] = [];

  visitDirectChildren(children, (part, value) => {
    if (value == null || value === false) return;
    if (part?.kind === "button") {
      individualZone.push(value as JSX.Element);
    } else {
      containerZone.push(value as JSX.Element);
    }
  });

  return { containerZone, individualZone };
}

export function hasDirectInputGroupButton(children: unknown) {
  let result = false;
  visitDirectChildren(children, (part) => {
    if (part?.kind === "button") result = true;
  });
  return result;
}
