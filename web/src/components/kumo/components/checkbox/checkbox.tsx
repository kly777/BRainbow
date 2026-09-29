import { Checkbox as BaseCheckbox } from "@photon-ai/base-ui-solid/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@photon-ai/base-ui-solid/checkbox-group";
import { Field as FieldBase } from "@photon-ai/base-ui-solid/field";
import { Fieldset } from "@photon-ai/base-ui-solid/fieldset";
import {
  createContext,
  createEffect,
  Show,
  splitProps,
  useContext,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { CheckIcon, MinusIcon } from "../../internal/icons";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";
import { Label } from "../label";

type BaseCheckboxRootProps = ComponentProps<typeof BaseCheckbox.Root>;

export type CheckboxChangeEventDetails = Parameters<
  NonNullable<BaseCheckboxRootProps["onCheckedChange"]>
>[1];

export const KUMO_CHECKBOX_VARIANTS = {
  variant: {
    default: {
      classes:
        "[&:focus-within>span]:ring-kumo-focus [&:hover>span]:ring-kumo-hairline",
      description: "Default checkbox appearance",
    },
    error: {
      classes: "[&>span]:ring-kumo-danger",
      description: "Error state for validation failures",
    },
  },
} as const;

export const KUMO_CHECKBOX_DEFAULT_VARIANTS = {
  variant: "default",
} as const;

export type KumoCheckboxVariant = keyof typeof KUMO_CHECKBOX_VARIANTS.variant;
export type CheckboxVariant = KumoCheckboxVariant;

export interface KumoCheckboxVariantsProps {
  variant?: KumoCheckboxVariant;
}

export function checkboxVariants({
  variant = KUMO_CHECKBOX_DEFAULT_VARIANTS.variant,
}: KumoCheckboxVariantsProps = {}) {
  return cn(
    resolveVariant(
      KUMO_CHECKBOX_VARIANTS.variant,
      variant,
      KUMO_CHECKBOX_DEFAULT_VARIANTS.variant,
    ).classes,
  );
}

interface CheckboxGroupContextValue {
  readonly controlFirst: boolean;
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue>({
  controlFirst: true,
});

export type CheckboxProps = {
  variant?: CheckboxVariant;
  label?: JSX.Element;
  labelTooltip?: JSX.Element;
  controlFirst?: boolean;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange?: BaseCheckboxRootProps["onCheckedChange"];
  name?: string;
  required?: boolean;
  className?: string;
  ref?: BaseCheckboxRootProps["ref"];
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export interface CheckboxLegendProps {
  children: JSX.Element;
  className?: string;
}

export interface CheckboxGroupProps {
  legend?: string;
  children: JSX.Element;
  error?: string;
  description?: JSX.Element;
  defaultValue?: string[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
  allValues?: string[];
  disabled?: boolean;
  controlFirst?: boolean;
  className?: string;
}

export type CheckboxItemProps = {
  variant?: CheckboxVariant;
  label: string;
  value?: string;
  className?: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange?: BaseCheckboxRootProps["onCheckedChange"];
  name?: string;
  ref?: BaseCheckboxRootProps["ref"];
};

function CheckboxIndicator() {
  return (
    <BaseCheckbox.Indicator
      keepMounted
      class="flex items-center justify-center text-kumo-inverse data-[unchecked]:invisible"
      render={(renderProps, state) => (
        <span {...renderProps}>
          {state.indeterminate ? (
            <MinusIcon size={12} />
          ) : (
            <CheckIcon size={12} />
          )}
        </span>
      )}
    />
  );
}

function CheckboxBase(inputProps: CheckboxProps) {
  const [props, ariaProps] = splitProps(inputProps, [
    "className",
    "checked",
    "indeterminate",
    "disabled",
    "variant",
    "label",
    "labelTooltip",
    "controlFirst",
    "onCheckedChange",
    "required",
    "name",
    "ref",
  ]);
  const variant = () => props.variant ?? KUMO_CHECKBOX_DEFAULT_VARIANTS.variant;
  const hasLabel = () => Boolean(props.label);

  if (import.meta.env?.DEV) {
    createEffect(() => {
      if (
        !hasLabel() &&
        !ariaProps["aria-label"] &&
        !ariaProps["aria-labelledby"]
      ) {
        console.warn(
          "[Kumo Checkbox]: Checkbox must have an accessible name. Provide either:\n" +
            "  - label prop: <Checkbox label='Accept terms' />\n" +
            "  - aria-label: <Checkbox aria-label='Select item' />\n" +
            "  - aria-labelledby for custom label association\n" +
            "  Note: When used inside Checkbox.Group, label is optional",
        );
      }
    });
  }

  const control = () => (
    <BaseCheckbox.Root
      ref={props.ref}
      data-kumo-component="Checkbox"
      name={props.name}
      checked={props.checked}
      indeterminate={props.indeterminate}
      disabled={props.disabled}
      onCheckedChange={props.onCheckedChange}
      class={cn(
        "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-0 bg-kumo-base ring after:absolute after:-inset-x-3 after:-inset-y-2 focus:outline-none",
        hasLabel() && "mt-0.5",
        variant() === "error" ? "ring-kumo-danger" : "ring-kumo-hairline",
        !props.disabled &&
          "hover:ring-kumo-hairline focus:ring-2 focus:ring-kumo-focus focus-visible:ring-2 focus-visible:ring-kumo-brand",
        "data-[checked]:bg-kumo-contrast data-[checked]:ring-kumo-contrast data-[indeterminate]:bg-kumo-contrast data-[indeterminate]:ring-kumo-contrast",
        props.disabled && "cursor-not-allowed opacity-50",
        props.className,
      )}
      {...ariaProps}
    >
      <CheckboxIndicator />
    </BaseCheckbox.Root>
  );

  return (
    <Show when={hasLabel()} fallback={control()}>
      <FieldBase.Root class="inline-flex">
        <FieldBase.Label
          class={cn(
            "!m-0 inline-flex !min-h-0 items-start gap-2 !text-base",
            (props.controlFirst ?? true)
              ? "flex-row"
              : "flex-row-reverse justify-end",
            props.disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {control()}
          <Label
            showOptional={props.required === false}
            tooltip={props.labelTooltip}
            asContent
          >
            {props.label}
          </Label>
        </FieldBase.Label>
      </FieldBase.Root>
    </Show>
  );
}

function CheckboxItem(props: CheckboxItemProps) {
  const group = useContext(CheckboxGroupContext);
  const variant = () => props.variant ?? KUMO_CHECKBOX_DEFAULT_VARIANTS.variant;

  return (
    <label
      data-kumo-component="Checkbox"
      data-kumo-part="item-label"
      class={cn(
        "relative m-0 inline-flex items-start gap-2",
        !group.controlFirst && "flex-row-reverse justify-end",
        props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        props.className,
      )}
    >
      <BaseCheckbox.Root
        ref={props.ref}
        data-kumo-component="Checkbox"
        data-kumo-part="item"
        value={props.value}
        name={props.name}
        checked={props.checked}
        indeterminate={props.indeterminate}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
        class={cn(
          "peer relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-0 bg-kumo-base ring after:absolute after:-inset-x-3 after:-inset-y-2",
          variant() === "error" ? "ring-kumo-danger" : "ring-kumo-hairline",
          !props.disabled &&
            "group-hover:ring-kumo-hairline hover:ring-kumo-hairline focus:ring-2 focus:ring-kumo-focus focus-visible:ring-2 focus-visible:ring-kumo-brand",
          "data-[checked]:bg-kumo-contrast data-[checked]:ring-kumo-contrast data-[indeterminate]:bg-kumo-contrast data-[indeterminate]:ring-kumo-contrast",
        )}
      >
        <CheckboxIndicator />
      </BaseCheckbox.Root>
      <span class="text-base text-kumo-default">{props.label}</span>
    </label>
  );
}

function CheckboxLegend(props: CheckboxLegendProps) {
  return (
    <Fieldset.Legend
      class={cn("text-base font-medium text-kumo-default", props.className)}
    >
      {props.children}
    </Fieldset.Legend>
  );
}

function CheckboxGroup(props: CheckboxGroupProps) {
  const context: CheckboxGroupContextValue = {
    get controlFirst() {
      return props.controlFirst ?? true;
    },
  };

  return (
    <CheckboxGroupContext.Provider value={context}>
      <BaseCheckboxGroup
        defaultValue={props.defaultValue}
        value={props.value}
        onValueChange={props.onValueChange}
        allValues={props.allValues}
        disabled={props.disabled}
      >
        <Fieldset.Root class={cn("flex flex-col gap-4", props.className)}>
          <Show when={props.legend}>
            {(legend) => (
              <Fieldset.Legend class="text-base font-medium text-kumo-default">
                {legend()}
              </Fieldset.Legend>
            )}
          </Show>
          <div class="flex flex-col gap-2">{props.children}</div>
          <Show when={props.error}>
            {(error) => <p class="text-sm text-kumo-danger">{error()}</p>}
          </Show>
          <Show when={props.description}>
            {(description) => (
              <p class="text-sm text-kumo-subtle">{description()}</p>
            )}
          </Show>
        </Fieldset.Root>
      </BaseCheckboxGroup>
    </CheckboxGroupContext.Provider>
  );
}

export const Checkbox = Object.assign(CheckboxBase, {
  Item: CheckboxItem,
  Group: CheckboxGroup,
  Legend: CheckboxLegend,
});
