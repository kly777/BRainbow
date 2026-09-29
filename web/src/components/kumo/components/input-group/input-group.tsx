import {
  createMemo,
  createSignal,
  createUniqueId,
  splitProps,
  type JSX,
} from "solid-js";
import { cn } from "../../utils/cn";
import { Field } from "../field";
import { inputVariants } from "../input";
import { Addon, type InputGroupAddonProps } from "./input-group-addon";
import { Button } from "./input-group-button";
import { Input } from "./input-group-input";
import { Suffix, type InputGroupSuffixProps } from "./input-group-suffix";
import {
  detectFocusMode,
  INPUT_GROUP_HAS_CLASSES,
  InputGroupContext,
  partitionChildren,
  type InputGroupRootPropsInternal,
} from "./context";

export type { InputGroupRootProps } from "./context";
export type { InputGroupInputProps } from "./input-group-input";
export type { InputGroupButtonProps } from "./input-group-button";
export type { InputGroupAddonProps } from "./input-group-addon";
export type { InputGroupSuffixProps } from "./input-group-suffix";

export const KUMO_INPUT_GROUP_VARIANTS = {
  size: {
    xs: {
      classes: "h-6 text-xs",
      description: "Extra small size.",
    },
    sm: {
      classes: "h-7 text-xs",
      description: "Small size.",
    },
    base: {
      classes: "h-9 text-base",
      description: "Default size.",
    },
    lg: {
      classes: "h-11 text-base",
      description: "Large size.",
    },
  },
} as const;

export const KUMO_INPUT_GROUP_DEFAULT_VARIANTS = {
  size: "base",
} as const;

function InputGroupRoot(inputProps: InputGroupRootPropsInternal) {
  const [props, elementProps] = splitProps(inputProps, [
    "size",
    "children",
    "class",
    "className",
    "disabled",
    "label",
    "description",
    "error",
    "required",
    "labelTooltip",
    "ref",
    "onClick",
  ]);
  const inputId = `kumo-input-group-${createUniqueId()}`;
  const [focusMode, setFocusMode] = createSignal<
    "container" | "individual" | "hybrid"
  >("container");
  const size = () => props.size ?? "base";
  const contextValue = {
    get size() {
      return size();
    },
    get focusMode() {
      return focusMode();
    },
    get disabled() {
      return props.disabled ?? false;
    },
    get error() {
      return props.error;
    },
    inputId,
    get label() {
      return props.label;
    },
  };

  function Content() {
    const rawChildren = createMemo(() => props.children);
    const layout = createMemo(() => {
      const value = rawChildren();
      const mode = detectFocusMode(value);
      setFocusMode(mode);
      return {
        mode,
        raw: value,
        ...(mode === "hybrid"
          ? partitionChildren(value)
          : { containerZone: [], individualZone: [] }),
      };
    });
    const containerClassName = () =>
      cn(
        "relative w-full cursor-text",
        inputVariants({ size: size() }),
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        layout().mode === "container"
          ? [
              "overflow-hidden",
              "focus-within:ring-[1.5px] focus-within:ring-kumo-focus/50",
            ]
          : "isolate overflow-visible shadow-none ring-0",
        "has-[input[aria-invalid=true]]:ring-kumo-danger",
        "px-0",
        "flex items-center gap-0",
        "has-[[data-slot=input-group-suffix]]:[&_input]:[field-sizing:content]",
        "has-[[data-slot=input-group-suffix]]:[&_input]:max-w-full",
        "has-[[data-slot=input-group-suffix]]:[&_input]:grow-0",
        "has-[[data-slot=input-group-suffix]]:[&_input]:pr-0",
        INPUT_GROUP_HAS_CLASSES[size()],
        "!mb-0",
        props.class,
        props.className,
      );
    const dataDisabled = () => (props.disabled ? "" : undefined);
    const focusInput = () => {
      if (!props.disabled) {
        document.getElementById(inputId)?.focus();
      }
    };

    if (layout().mode === "hybrid") {
      return (
        <div
          {...elementProps}
          ref={props.ref as JSX.HTMLAttributes<HTMLDivElement>["ref"]}
          data-slot="input-group"
          data-focus-mode="hybrid"
          data-disabled={dataDisabled()}
          class={containerClassName()}
          onClick={props.onClick}
        >
          <div
            data-slot="input-group-container-zone"
            class={cn(
              inputVariants({ size: size() }),
              "overflow-hidden",
              "has-[input[aria-invalid=true]]:ring-kumo-danger",
              "px-0",
              "flex min-w-0 flex-1 items-center gap-0",
              "shadow-none ring-0",
              "border border-kumo-line",
              "focus-within:border-kumo-focus/50",
              "focus-within:z-2",
              "not-first:-ml-px",
              "rounded-none first:rounded-l-[inherit] last:rounded-r-[inherit]",
              INPUT_GROUP_HAS_CLASSES[size()],
              "has-data-[slot=input-group-suffix]:[&_input]:field-sizing-content",
              "has-data-[slot=input-group-suffix]:[&_input]:max-w-full",
              "has-data-[slot=input-group-suffix]:[&_input]:grow-0",
              "has-data-[slot=input-group-suffix]:[&_input]:pr-0",
            )}
          >
            {props.label && (
              <label
                for={inputId}
                class="absolute inset-0 z-0 mb-0! cursor-text"
                aria-hidden="true"
                onClick={focusInput}
              />
            )}
            {layout().containerZone}
          </div>
          {layout().individualZone}
        </div>
      );
    }

    if (props.label) {
      return (
        <div
          {...elementProps}
          ref={props.ref as JSX.HTMLAttributes<HTMLDivElement>["ref"]}
          data-slot="input-group"
          data-focus-mode={layout().mode}
          data-disabled={dataDisabled()}
          class={containerClassName()}
          onClick={props.onClick}
        >
          <label
            for={inputId}
            class="absolute inset-0 z-0 mb-0! cursor-text"
            aria-hidden="true"
            onClick={focusInput}
          />
          {layout().raw}
        </div>
      );
    }

    if (layout().mode === "container") {
      return (
        <label
          {...elementProps}
          ref={props.ref as JSX.LabelHTMLAttributes<HTMLLabelElement>["ref"]}
          for={inputId}
          data-slot="input-group"
          data-focus-mode="container"
          data-disabled={dataDisabled()}
          class={cn(containerClassName(), "mb-0!")}
          onClick={(event) => {
            const handler = props.onClick;
            if (typeof handler === "function") {
              handler(event);
            } else if (handler) {
              handler[0](handler[1], event);
            }
            if (
              !event.defaultPrevented &&
              !(event.target as Element).closest("button")
            ) {
              focusInput();
            }
          }}
        >
          {layout().raw}
        </label>
      );
    }

    return (
      <div
        {...elementProps}
        ref={props.ref as JSX.HTMLAttributes<HTMLDivElement>["ref"]}
        data-slot="input-group"
        data-focus-mode="individual"
        data-disabled={dataDisabled()}
        class={containerClassName()}
        onClick={props.onClick}
      >
        {layout().raw}
      </div>
    );
  }

  return (
    <InputGroupContext.Provider value={contextValue}>
      {props.label ? (
        <Field
          label={props.label}
          description={props.description}
          error={props.error}
          required={props.required}
          labelTooltip={props.labelTooltip}
        >
          <Content />
        </Field>
      ) : (
        <Content />
      )}
    </InputGroupContext.Provider>
  );
}

function Label(inputProps: InputGroupAddonProps) {
  return <Addon align="start" {...inputProps} />;
}

function Description(inputProps: InputGroupSuffixProps) {
  return <Suffix {...inputProps} />;
}

type InputGroupComponent = typeof InputGroupRoot & {
  Addon: typeof Addon;
  Button: typeof Button;
  Description: typeof Description;
  Input: typeof Input;
  Label: typeof Label;
  Suffix: typeof Suffix;
};

export const InputGroup = Object.assign(InputGroupRoot, {
  Input,
  Button,
  Addon,
  Suffix,
  Label,
  Description,
}) as InputGroupComponent;
