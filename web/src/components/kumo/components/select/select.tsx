import { Select as SelectBase } from "@photon-ai/base-ui-solid/select";
import {
  For,
  Show,
  children,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Accessor,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { CaretUpDownIcon, CheckIcon } from "../../internal/icons";
import { cn } from "../../utils/cn";
import {
  usePortalContainerAccessor,
  type PortalContainer,
} from "../../utils/portal-provider";
import { buttonVariants } from "../button";
import { Field, normalizeFieldError, type FieldErrorMatch } from "../field";
import { KUMO_INPUT_VARIANTS, type KumoInputSize } from "../input/input";
import { SkeletonLine } from "../loader";

/** Select variant definitions. */
export const KUMO_SELECT_VARIANTS = {
  size: KUMO_INPUT_VARIANTS.size,
} as const;

export const KUMO_SELECT_DEFAULT_VARIANTS = {
  size: "base",
} as const;

export const KUMO_SELECT_STYLING = {
  trigger: {
    height: 36,
    paddingX: 12,
    borderRadius: 8,
    background: "bg-kumo-elevated",
    text: "text-color-surface",
    ring: "color-border",
    fontSize: 16,
    fontWeight: 400,
  },
  stateTokens: {
    focus: { ring: "color-active" },
    disabled: { opacity: 0.5 },
  },
  icons: {
    caret: { name: "ph-caret-up-down", size: 20 },
    check: { name: "ph-check", size: 20 },
  },
  popup: {
    background: "bg-kumo-elevated",
    ring: "border-kumo-line",
    borderRadius: 8,
    padding: 6,
  },
  option: {
    paddingX: 8,
    paddingY: 6,
    borderRadius: 4,
    fontSize: 16,
    highlightBackground: "color-surface-secondary",
  },
} as const;

export type KumoSelectSize = keyof typeof KUMO_SELECT_VARIANTS.size;

export interface KumoSelectVariantsProps {
  size?: KumoSelectSize;
}

export function selectVariants({
  size = KUMO_SELECT_DEFAULT_VARIANTS.size,
}: KumoSelectVariantsProps = {}) {
  return cn(
    buttonVariants({ size }),
    "justify-between font-normal",
    "focus:opacity-100 focus:ring-kumo-focus/50 focus-visible:ring-inset *:in-focus:opacity-100",
  );
}

const triggerIconStyles: Record<
  KumoInputSize,
  { iconSize: number; className: string }
> = {
  xs: { iconSize: 12, className: "text-kumo-subtle" },
  sm: { iconSize: 14, className: "text-kumo-subtle" },
  base: { iconSize: 16, className: "text-kumo-subtle" },
  lg: { iconSize: 18, className: "text-kumo-subtle" },
};

export interface SelectItemDescriptor {
  label: JSX.Element;
  disabled?: boolean;
}

export type SelectItemValue = JSX.Element | SelectItemDescriptor;

interface NormalizedItem<T> {
  label: JSX.Element;
  value: T;
  disabled?: boolean;
}

function isItemDescriptor(
  value: SelectItemValue,
): value is SelectItemDescriptor {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  if (value instanceof Promise) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return "label" in candidate && candidate.label !== undefined;
}

function normalizeItems<T>(
  items:
    | Record<string, SelectItemValue>
    | ReadonlyArray<{ label: JSX.Element; value: T }>,
): ReadonlyArray<NormalizedItem<T>> {
  if (Array.isArray(items)) {
    return items;
  }

  return Object.entries(items).map(([key, entry]) => ({
    value: key as T,
    label: isItemDescriptor(entry) ? entry.label : entry,
    disabled: isItemDescriptor(entry) ? entry.disabled : undefined,
  }));
}

type SelectValue<
  T,
  Multiple extends boolean | undefined,
> = Multiple extends true ? T[] : T | null;

type BaseRootProps<T> = SelectBase.Root.Props<T>;

export type SelectPropsGeneric<
  T,
  Multiple extends boolean | undefined = false,
> = Omit<
  BaseRootProps<T>,
  "children" | "defaultValue" | "disabled" | "items" | "onValueChange" | "value"
> &
  KumoSelectVariantsProps & {
    children?: JSX.Element;
    class?: string;
    className?: string;
    container?: PortalContainer;
    defaultValue?: SelectValue<T, Multiple>;
    description?: JSX.Element;
    disabled?: boolean;
    error?: string | { message: JSX.Element; match: FieldErrorMatch };
    hideLabel?: boolean;
    isItemEqualToValue?: (item: T, value: T) => boolean;
    items?:
      | Record<string, SelectItemValue>
      | ReadonlyArray<{ label: JSX.Element; value: T }>;
    label?: JSX.Element;
    labelTooltip?: JSX.Element;
    loading?: boolean;
    multiple?: Multiple;
    onValueChange?: (
      value: Multiple extends true ? T[] : T,
      event?: Event,
    ) => void;
    placeholder?: string;
    renderValue?: (value: Multiple extends true ? T[] : T) => JSX.Element;
    value?: SelectValue<T, Multiple>;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  };

export interface SelectProps {
  children?: JSX.Element;
  class?: string;
  className?: string;
  container?: PortalContainer;
  defaultValue?: unknown;
  description?: JSX.Element;
  disabled?: boolean;
  error?: string | { message: JSX.Element; match: FieldErrorMatch };
  hideLabel?: boolean;
  isItemEqualToValue?: (item: unknown, value: unknown) => boolean;
  items?:
    | Record<string, SelectItemValue>
    | ReadonlyArray<{ label: JSX.Element; value: unknown }>;
  label?: JSX.Element;
  labelTooltip?: JSX.Element;
  loading?: boolean;
  multiple?: boolean;
  onValueChange?: (value: unknown, event?: Event) => void;
  placeholder?: string;
  required?: boolean;
  size?: KumoSelectSize;
  value?: unknown;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface RegisteredOption {
  label: Accessor<JSX.Element>;
  value: unknown;
}

interface SelectContextValue {
  isSelected: (value: unknown) => boolean;
  registerOption: (option: RegisteredOption) => () => void;
}

const SelectContext = createContext<SelectContextValue>();

function useSelectContext() {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error("Select subcomponents must be used inside <Select>.");
  }
  return context;
}

function valuesEqual<T>(
  item: T,
  value: T,
  isItemEqualToValue?: (item: T, value: T) => boolean,
) {
  if (Object.is(item, value)) return true;
  if (item == null || value == null) return false;
  return isItemEqualToValue?.(item, value) ?? false;
}

function serializeFormValue(value: unknown) {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function displayValue(value: unknown) {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  return "";
}

function SelectRoot<T, Multiple extends boolean | undefined = false>(
  inputProps: SelectPropsGeneric<T, Multiple>,
) {
  const [props, rootProps] = splitProps(inputProps, [
    "aria-label",
    "aria-labelledby",
    "children",
    "class",
    "className",
    "container",
    "defaultOpen",
    "defaultValue",
    "description",
    "disabled",
    "error",
    "hideLabel",
    "isItemEqualToValue",
    "items",
    "label",
    "labelTooltip",
    "loading",
    "multiple",
    "name",
    "onOpenChange",
    "onValueChange",
    "open",
    "placeholder",
    "renderValue",
    "required",
    "size",
    "value",
  ]);
  const contextContainer = usePortalContainerAccessor();
  const labelId = createUniqueId();
  const controlled = inputProps.value !== undefined;
  const openControlled = inputProps.open !== undefined;
  const multiple = () => props.multiple === true;
  const size = () => props.size ?? KUMO_SELECT_DEFAULT_VARIANTS.size;
  const [uncontrolledValue, setUncontrolledValue] = createSignal<unknown>(
    props.defaultValue,
  );
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    props.defaultOpen ?? false,
  );
  const [baseMounted, setBaseMounted] = createSignal(false);
  const [registeredOptions, setRegisteredOptions] = createSignal<
    RegisteredOption[]
  >([]);
  const normalizedItems = createMemo(() =>
    props.items ? normalizeItems<T>(props.items) : undefined,
  );
  const currentValue = () =>
    (controlled ? props.value : uncontrolledValue()) ??
    (multiple() ? [] : null);
  const currentValues = () => {
    const value = currentValue();
    return Array.isArray(value) ? (value as T[]) : [];
  };
  const equal = (item: T, value: T) =>
    valuesEqual(item, value, props.isItemEqualToValue);
  const isSelected = (item: unknown) => {
    if (multiple()) {
      return currentValues().some((value) => equal(item as T, value));
    }
    return equal(item as T, currentValue() as T);
  };
  const registerOption = (option: RegisteredOption) => {
    setRegisteredOptions((options) => [...options, option]);
    return () =>
      setRegisteredOptions((options) =>
        options.filter((candidate) => candidate !== option),
      );
  };
  const knownOptions = createMemo<RegisteredOption[]>(() => [
    ...(normalizedItems()?.map((item) => ({
      label: () => item.label,
      value: item.value,
    })) ?? []),
    ...registeredOptions(),
  ]);
  const matchingOption = (value: unknown) =>
    knownOptions().find((option) => equal(option.value as T, value as T));
  const canonicalValue = createMemo<T | null>(() => {
    if (multiple()) return null;
    const value = currentValue();
    if (value == null) {
      return (matchingOption(value)?.value as T | undefined) ?? null;
    }
    return (matchingOption(value)?.value ?? value) as T;
  });
  const isEmpty = () => {
    if (multiple()) return currentValues().length === 0;
    const value = currentValue();
    if (value === null && matchingOption(null)) return false;
    return value == null || value === "";
  };
  const resolvedOpen = () =>
    openControlled ? (props.open ?? false) : uncontrolledOpen();
  const portalContainer = () =>
    props.container ?? contextContainer() ?? undefined;
  const useFieldWrapper = () => Boolean(props.label && !props.hideLabel);
  const fallbackLabel = () =>
    typeof props.label === "string" ? props.label : props.placeholder;
  const triggerAriaProps = createMemo<
    Pick<JSX.HTMLAttributes<HTMLElement>, "aria-label" | "aria-labelledby">
  >(() => {
    if (useFieldWrapper()) return {};
    const labelledBy =
      props["aria-labelledby"] ?? (props.label ? labelId : undefined);
    if (labelledBy) return { "aria-labelledby": labelledBy };
    const ariaLabel = props["aria-label"] ?? fallbackLabel();
    return ariaLabel ? { "aria-label": ariaLabel } : {};
  });

  if (import.meta.env?.DEV) {
    createEffect(() => {
      if (props.hideLabel !== undefined) {
        console.warn(
          "[Kumo Select]: `hideLabel` is deprecated. For hidden labels, use `aria-label` instead of `label` + `hideLabel={true}`.",
        );
      }
    });
  }

  onMount(() => {
    setBaseMounted(true);
  });

  const updateValue = (nextValue: T, event?: Event) => {
    if (multiple()) {
      const previous = currentValues();
      const index = previous.findIndex((value) => equal(nextValue, value));
      const next =
        index === -1
          ? [...previous, nextValue]
          : previous.filter((_, candidateIndex) => candidateIndex !== index);
      if (!controlled) {
        setUncontrolledValue(() => next);
      }
      props.onValueChange?.(next as Multiple extends true ? T[] : T, event);
      return;
    }

    if (!controlled) {
      setUncontrolledValue(() => nextValue);
    }
    props.onValueChange?.(nextValue as Multiple extends true ? T[] : T, event);
  };

  const updateOpen: BaseRootProps<T>["onOpenChange"] = (
    nextOpen,
    event,
    reason,
  ) => {
    if (multiple() && !nextOpen && reason === "item-press") return;
    if (!openControlled) setUncontrolledOpen(nextOpen);
    props.onOpenChange?.(nextOpen, event, reason);
  };

  const valueContent = () => {
    if (isEmpty()) {
      return props.placeholder ? (
        <span class="text-kumo-placeholder">{props.placeholder}</span>
      ) : null;
    }

    if (props.renderValue) {
      const rendered = props.renderValue(
        currentValue() as Multiple extends true ? T[] : T,
      );
      return rendered == null && props.placeholder ? (
        <span class="text-kumo-placeholder">{props.placeholder}</span>
      ) : (
        rendered
      );
    }

    if (multiple()) {
      return currentValues().map((value, index) => (
        <>
          {index > 0 ? ", " : null}
          {matchingOption(value)?.label() ?? displayValue(value)}
        </>
      ));
    }

    return <SelectBase.Value />;
  };

  const fallbackValueContent = () => {
    if (isEmpty()) {
      return props.placeholder ? (
        <span class="text-kumo-placeholder">{props.placeholder}</span>
      ) : null;
    }

    if (props.renderValue) {
      const rendered = props.renderValue(
        currentValue() as Multiple extends true ? T[] : T,
      );
      return rendered == null && props.placeholder ? (
        <span class="text-kumo-placeholder">{props.placeholder}</span>
      ) : (
        rendered
      );
    }

    if (multiple()) {
      return currentValues().map((value, index) => (
        <>
          {index > 0 ? ", " : null}
          {matchingOption(value)?.label() ?? displayValue(value)}
        </>
      ));
    }

    const value = currentValue();
    return matchingOption(value)?.label() ?? displayValue(value);
  };

  const renderedOptions = () => {
    if (props.children != null && props.children !== false) {
      return props.children;
    }

    return (
      <For each={normalizedItems()?.filter((item) => item.value !== null)}>
        {(item) => (
          <Option value={item.value} disabled={item.disabled}>
            {item.label}
          </Option>
        )}
      </For>
    );
  };

  const context: SelectContextValue = {
    isSelected,
    registerOption,
  };

  const triggerClass = () =>
    cn(
      selectVariants({ size: size() }),
      props.disabled && "cursor-not-allowed opacity-50",
      props.error &&
        "!ring-kumo-danger focus:ring-[1.5px] focus:ring-kumo-danger/50",
      props.class,
      props.className,
    );

  const baseSelectControl = () => (
    <SelectContext.Provider value={context}>
      <SelectBase.Root<T>
        {...rootProps}
        defaultOpen={multiple() ? undefined : props.defaultOpen}
        defaultValue={undefined}
        disabled={Boolean(props.loading || props.disabled)}
        items={
          multiple()
            ? undefined
            : (normalizedItems() as
                | Array<{ label: JSX.Element; value: T }>
                | undefined)
        }
        name={multiple() ? undefined : props.name}
        onOpenChange={updateOpen}
        onValueChange={updateValue}
        open={multiple() ? resolvedOpen() : props.open}
        required={
          multiple()
            ? Boolean(props.required && currentValues().length === 0)
            : props.required
        }
        value={multiple() ? null : canonicalValue()}
      >
        <SelectBase.Trigger
          {...triggerAriaProps()}
          data-kumo-component="Select"
          data-kumo-part="trigger"
          class={triggerClass()}
        >
          <Show
            when={!props.loading}
            fallback={<SkeletonLine className="w-32" />}
          >
            <span class="min-w-0 truncate">{valueContent()}</span>
          </Show>
          <SelectBase.Icon
            class={cn(
              "flex shrink-0 items-center",
              triggerIconStyles[size()].className,
            )}
          >
            <CaretUpDownIcon
              size={triggerIconStyles[size()].iconSize}
              class="fill-current"
            />
          </SelectBase.Icon>
        </SelectBase.Trigger>
        <SelectBase.Portal container={portalContainer()}>
          <SelectBase.Positioner>
            <SelectBase.Popup
              aria-multiselectable={multiple() ? "true" : undefined}
              class={cn(
                "flex min-h-0 flex-col",
                "max-h-[var(--available-height)] scroll-pt-2 scroll-pb-2 overflow-y-auto overscroll-none bg-kumo-base text-kumo-default",
                "rounded-lg shadow-lg ring ring-kumo-line",
                "min-w-[calc(var(--anchor-width)+3px)] py-1.5",
              )}
            >
              {renderedOptions()}
            </SelectBase.Popup>
          </SelectBase.Positioner>
        </SelectBase.Portal>
        <Show when={multiple() && props.name}>
          <For each={currentValues()}>
            {(value) => (
              <input
                type="hidden"
                name={props.name}
                value={serializeFormValue(value)}
              />
            )}
          </For>
        </Show>
      </SelectBase.Root>
    </SelectContext.Provider>
  );

  const fallbackSelectControl = () => (
    <>
      <Show when={useFieldWrapper()}>
        <span id={labelId} class="sr-only">
          {props.label}
        </span>
      </Show>
      <button
        {...(useFieldWrapper()
          ? { "aria-labelledby": labelId }
          : triggerAriaProps())}
        type="button"
        role="combobox"
        aria-expanded="false"
        aria-haspopup="listbox"
        aria-disabled={props.loading || props.disabled ? "true" : undefined}
        data-kumo-component="Select"
        data-kumo-part="trigger"
        class={triggerClass()}
        disabled={Boolean(props.loading || props.disabled)}
      >
        <Show
          when={!props.loading}
          fallback={<SkeletonLine className="w-32" />}
        >
          <span class="min-w-0 truncate">{fallbackValueContent()}</span>
        </Show>
        <span
          class={cn(
            "flex shrink-0 items-center",
            triggerIconStyles[size()].className,
          )}
        >
          <CaretUpDownIcon
            size={triggerIconStyles[size()].iconSize}
            class="fill-current"
          />
        </span>
      </button>
      <Show when={!multiple() && props.name}>
        <input
          type="hidden"
          name={props.name}
          value={serializeFormValue(currentValue())}
        />
      </Show>
      <Show when={multiple() && props.name}>
        <For each={currentValues()}>
          {(value) => (
            <input
              type="hidden"
              name={props.name}
              value={serializeFormValue(value)}
            />
          )}
        </For>
      </Show>
    </>
  );

  const selectControl = () => (
    <Show when={baseMounted()} fallback={fallbackSelectControl()}>
      {baseSelectControl()}
    </Show>
  );

  return (
    <Show
      when={useFieldWrapper()}
      fallback={
        <div class="grid gap-2">
          <Show when={props.label}>
            <span id={labelId} class="sr-only">
              {props.label}
            </span>
          </Show>
          {selectControl()}
          <Show
            when={normalizeFieldError(props.error)}
            fallback={
              props.description ? (
                <span class="text-sm leading-snug text-kumo-subtle">
                  {props.description}
                </span>
              ) : null
            }
          >
            {(normalizedError) => (
              <span class="text-sm text-kumo-danger">
                {normalizedError().message}
              </span>
            )}
          </Show>
        </div>
      }
    >
      <Field
        label={props.label}
        required={props.required}
        labelTooltip={props.labelTooltip}
        description={props.description}
        error={normalizeFieldError(props.error)}
      >
        {selectControl()}
      </Field>
    </Show>
  );
}

export interface SelectOptionProps<T = unknown> extends Omit<
  ComponentProps<typeof SelectBase.Item>,
  "children" | "class" | "disabled" | "value"
> {
  children: JSX.Element;
  class?: string;
  className?: string;
  disabled?: boolean;
  value: T;
}

function Option<T>(inputProps: SelectOptionProps<T>) {
  const [props, itemProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "disabled",
    "value",
  ]);
  const context = useSelectContext();
  const resolvedChildren = children(() => props.children);
  const selected = () => context.isSelected(props.value);
  const option: RegisteredOption = {
    label: resolvedChildren,
    get value() {
      return props.value;
    },
  };

  onMount(() => {
    const unregister = context.registerOption(option);
    onCleanup(unregister);
  });

  return (
    <SelectBase.Item
      {...itemProps}
      aria-selected={selected()}
      data-kumo-component="Select"
      data-kumo-part="option"
      data-selected={selected() ? "" : undefined}
      value={props.value}
      disabled={props.disabled}
      label={
        typeof resolvedChildren() === "string"
          ? (resolvedChildren() as string)
          : undefined
      }
      class={cn(
        "group mx-1.5 flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-base outline-none",
        "focus-visible:z-50 focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:ring-inset",
        "data-highlighted:bg-kumo-tint",
        "data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        props.class,
        props.className,
      )}
    >
      <SelectBase.ItemText>{resolvedChildren()}</SelectBase.ItemText>
      <Show when={selected()}>
        <span aria-hidden="true">
          <CheckIcon />
        </span>
      </Show>
    </SelectBase.Item>
  );
}

export interface SelectGroupProps extends Omit<
  ComponentProps<typeof SelectBase.Group>,
  "children" | "class"
> {
  children: JSX.Element;
  class?: string;
  className?: string;
}

function Group(inputProps: SelectGroupProps) {
  const [props, groupProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
  ]);
  return (
    <SelectBase.Group {...groupProps} class={cn(props.class, props.className)}>
      {props.children}
    </SelectBase.Group>
  );
}

export interface SelectGroupLabelProps extends Omit<
  ComponentProps<typeof SelectBase.GroupLabel>,
  "children" | "class"
> {
  children: JSX.Element;
  class?: string;
  className?: string;
}

function GroupLabel(inputProps: SelectGroupLabelProps) {
  const [props, labelProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
  ]);
  return (
    <SelectBase.GroupLabel
      {...labelProps}
      class={cn(
        "px-3.5 py-1.5 text-sm font-semibold text-kumo-subtle",
        props.class,
        props.className,
      )}
    >
      {props.children}
    </SelectBase.GroupLabel>
  );
}

export interface SelectSeparatorProps extends Omit<
  ComponentProps<typeof SelectBase.Separator>,
  "class"
> {
  class?: string;
  className?: string;
}

function Separator(inputProps: SelectSeparatorProps) {
  const [props, separatorProps] = splitProps(inputProps, [
    "class",
    "className",
  ]);
  return (
    <SelectBase.Separator
      {...separatorProps}
      class={cn(
        "-mx-1 my-1 h-px bg-kumo-hairline",
        props.class,
        props.className,
      )}
    />
  );
}

type SelectComponent = typeof SelectRoot & {
  Group: typeof Group;
  GroupLabel: typeof GroupLabel;
  Option: typeof Option;
  Separator: typeof Separator;
};

export const Select = Object.assign(SelectRoot, {
  Group,
  GroupLabel,
  Option,
  Separator,
}) as SelectComponent;
