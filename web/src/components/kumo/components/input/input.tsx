import { Input as BaseInput } from "@photon-ai/base-ui-solid/input";
import {
  createEffect,
  splitProps,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";
import { Field, normalizeFieldError, type FieldErrorMatch } from "../field";

export const KUMO_INPUT_VARIANTS = {
  size: {
    xs: {
      classes: "h-5 gap-1 rounded-sm px-1.5 text-xs",
      description: "Extra small input for compact UIs",
    },
    sm: {
      classes: "h-6.5 gap-1 rounded-md px-2 text-xs",
      description: "Small input for secondary fields",
    },
    base: {
      classes: "h-9 gap-1.5 rounded-lg px-3 text-base",
      description: "Default input size",
    },
    lg: {
      classes: "h-10 gap-2 rounded-lg px-4 text-base",
      description: "Large input for prominent fields",
    },
  },
  variant: {
    default: {
      classes: "focus:ring-kumo-focus/50 focus:ring-[1.5px]",
      description: "Default input appearance",
    },
    error: {
      classes: "!ring-kumo-danger focus:ring-kumo-danger/50 focus:ring-[1.5px]",
      description: "Error state for validation failures",
    },
  },
} as const;

export const KUMO_INPUT_DEFAULT_VARIANTS = {
  size: "base",
  variant: "default",
} as const;

export const KUMO_INPUT_STYLING = {
  dimensions: {
    xs: { height: 20, paddingX: 6, fontSize: 12, borderRadius: 2, width: 160 },
    sm: { height: 26, paddingX: 8, fontSize: 12, borderRadius: 6, width: 200 },
    base: {
      height: 36,
      paddingX: 12,
      fontSize: 16,
      borderRadius: 8,
      width: 280,
    },
    lg: { height: 40, paddingX: 16, fontSize: 16, borderRadius: 8, width: 320 },
  },
  baseTokens: {
    background: "color-secondary",
    text: "text-color-surface",
    placeholder: "text-color-muted",
    ring: "color-border",
  },
  stateTokens: {
    focus: { ring: "color-active" },
    error: { ring: "color-error" },
    disabled: { opacity: 0.5, text: "text-color-muted" },
  },
} as const;

export type KumoInputSize = keyof typeof KUMO_INPUT_VARIANTS.size;
export type KumoInputVariant = keyof typeof KUMO_INPUT_VARIANTS.variant;

export interface KumoInputVariantsProps {
  size?: KumoInputSize;
  variant?: KumoInputVariant;
  parentFocusIndicator?: boolean;
  focusIndicator?: boolean;
}

type BaseInputProps = Omit<
  ComponentProps<typeof BaseInput>,
  "class" | "onInput" | "onValueChange" | "size"
>;

export function inputVariants({
  variant = KUMO_INPUT_DEFAULT_VARIANTS.variant,
  size = KUMO_INPUT_DEFAULT_VARIANTS.size,
  parentFocusIndicator = false,
  focusIndicator = false,
}: KumoInputVariantsProps = {}) {
  return cn(
    "border-0 bg-kumo-control text-kumo-default ring ring-kumo-line outline-none focus:outline-none",
    "kumo-input-placeholder disabled:text-kumo-disabled",
    resolveVariant(
      KUMO_INPUT_VARIANTS.size,
      size,
      KUMO_INPUT_DEFAULT_VARIANTS.size,
    ).classes,
    resolveVariant(
      KUMO_INPUT_VARIANTS.variant,
      variant,
      KUMO_INPUT_DEFAULT_VARIANTS.variant,
    ).classes,
    parentFocusIndicator &&
      (variant === "error"
        ? "focus-within:ring-[1.5px] focus-within:ring-kumo-danger/50"
        : "focus-within:ring-[1.5px] focus-within:ring-kumo-focus/50"),
    focusIndicator &&
      (variant === "error"
        ? "focus:ring-[1.5px] focus:ring-kumo-danger/50"
        : "focus:ring-[1.5px] focus:ring-kumo-focus/50"),
  );
}

export type InputProps = Pick<KumoInputVariantsProps, "size" | "variant"> &
  BaseInputProps & {
    class?: string;
    className?: string;
    label?: JSX.Element;
    labelTooltip?: JSX.Element;
    description?: JSX.Element;
    error?: string | { message: JSX.Element; match: FieldErrorMatch };
    passwordManagerIgnore?: boolean;
    onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>;
    onValueChange?: (value: string, event: Event) => void;
  };

export function Input(inputProps: InputProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "class",
    "className",
    "size",
    "variant",
    "label",
    "labelTooltip",
    "description",
    "error",
    "passwordManagerIgnore",
    "onInput",
    "onValueChange",
    "ref",
  ]);
  let lastInputValue: string | undefined;
  const size = () => props.size ?? KUMO_INPUT_DEFAULT_VARIANTS.size;
  const variant = () =>
    props.variant ??
    (props.error ? "error" : KUMO_INPUT_DEFAULT_VARIANTS.variant);
  const shouldWrap = () =>
    Boolean(props.label || props.error || props.description);

  if (import.meta.env?.DEV) {
    createEffect(() => {
      if (props.variant === "error") {
        console.warn(
          '[Kumo Input]: variant="error" is deprecated. ' +
            "Error styling is now automatically applied when the `error` prop is truthy. " +
            "Simply remove the variant prop and pass an error message instead.",
        );
      }
    });

    createEffect(() => {
      if (
        !props.label &&
        !elementProps["aria-label"] &&
        !elementProps["aria-labelledby"]
      ) {
        console.warn(
          "[Kumo Input]: Input must have an accessible name. Provide either:\n" +
            "  - label prop: <Input label='Email' />\n" +
            "  - aria-label: <Input aria-label='Email address' />\n" +
            "  - aria-labelledby for custom label association",
        );
      }
    });
  }

  const input = () => (
    <BaseInput
      ref={props.ref}
      class={cn(
        inputVariants({
          size: size(),
          variant: variant(),
          focusIndicator: true,
        }),
        props.passwordManagerIgnore && "keeper-ignore",
        props.class,
        props.className,
      )}
      data-1p-ignore={props.passwordManagerIgnore ? "true" : undefined}
      data-bwignore={props.passwordManagerIgnore ? "true" : undefined}
      data-form-type={props.passwordManagerIgnore ? "other" : undefined}
      data-lpignore={props.passwordManagerIgnore ? "true" : undefined}
      onInput={(event) => {
        props.onInput?.(event);
        lastInputValue = event.currentTarget.value;
        props.onValueChange?.(event.currentTarget.value, event);
      }}
      onValueChange={(value, event) => {
        if (lastInputValue === value) {
          lastInputValue = undefined;
          return;
        }
        props.onValueChange?.(value, event);
      }}
      {...elementProps}
    />
  );

  return (
    <>
      {shouldWrap() ? (
        <Field
          label={props.label}
          required={elementProps.required}
          labelTooltip={props.labelTooltip}
          description={props.description}
          error={normalizeFieldError(props.error)}
        >
          {input()}
        </Field>
      ) : (
        input()
      )}
    </>
  );
}
