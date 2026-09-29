import { Fieldset } from "@photon-ai/base-ui-solid/fieldset";
import {
  createContext,
  createSignal,
  createUniqueId,
  splitProps,
  useContext,
  type JSX,
  type Ref,
} from "solid-js";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";
import { Field } from "../field";

export const KUMO_SWITCH_VARIANTS = {
  size: {
    sm: {
      classes: "h-5.5 w-8.5",
      description: "Small switch for compact UIs",
    },
    base: {
      classes: "h-6.5 w-10.5",
      description: "Default switch size",
    },
    lg: {
      classes: "h-7.5 w-12.5",
      description: "Large switch for prominent toggles",
    },
  },
  variant: {
    default: {
      classes: "",
      description: "Default switch with squircle shape and brand blue color",
    },
    neutral: {
      classes: "",
      description: "Monochrome switch with squircle shape for subtle toggles",
    },
  },
} as const;

export const KUMO_SWITCH_DEFAULT_VARIANTS = {
  size: "base",
  variant: "default",
} as const;

export type KumoSwitchSize = keyof typeof KUMO_SWITCH_VARIANTS.size;
export type KumoSwitchVariant = keyof typeof KUMO_SWITCH_VARIANTS.variant;

export interface KumoSwitchVariantsProps {
  size?: KumoSwitchSize;
  variant?: KumoSwitchVariant;
}

export function switchVariants({
  size = KUMO_SWITCH_DEFAULT_VARIANTS.size,
  variant = KUMO_SWITCH_DEFAULT_VARIANTS.variant,
}: KumoSwitchVariantsProps = {}) {
  const sizeConfig = resolveVariant(
    KUMO_SWITCH_VARIANTS.size,
    size,
    KUMO_SWITCH_DEFAULT_VARIANTS.size,
  );
  const variantConfig = resolveVariant(
    KUMO_SWITCH_VARIANTS.variant,
    variant,
    KUMO_SWITCH_DEFAULT_VARIANTS.variant,
  );
  return cn(sizeConfig.classes, variantConfig.classes);
}

export type SwitchSize = KumoSwitchSize;
export type SwitchVariant = KumoSwitchVariant;

type SwitchRef = Ref<HTMLButtonElement>;

type NativeSwitchProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "class" | "className" | "ref" | "type"
>;

export type SwitchProps = NativeSwitchProps & {
  variant?: SwitchVariant;
  label?: JSX.Element;
  labelTooltip?: JSX.Element;
  required?: boolean;
  readOnly?: boolean;
  controlFirst?: boolean;
  size?: KumoSwitchSize;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  transitioning?: boolean;
  class?: string;
  className?: string;
  ref?: SwitchRef;
};

export interface SwitchLegendProps {
  children: JSX.Element;
  className?: string;
}

export interface SwitchGroupProps {
  legend?: string;
  children: JSX.Element;
  error?: string;
  description?: JSX.Element;
  disabled?: boolean;
  controlFirst?: boolean;
  className?: string;
}

export type SwitchItemProps = {
  variant?: SwitchVariant;
  label: string;
  className?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: KumoSwitchSize;
  transitioning?: boolean;
  name?: string;
  ref?: SwitchRef;
};

interface SwitchGroupContextValue {
  readonly controlFirst: boolean;
}

const SwitchGroupContext = createContext<SwitchGroupContextValue>({
  controlFirst: true,
});

const SWITCH_SIZE_STYLES = {
  sm: { track: "h-4 w-8", thumb: "w-4", slide: "left-4" },
  base: { track: "h-4.5 w-9", thumb: "w-4.5", slide: "left-4.5" },
  lg: { track: "h-5 w-10", thumb: "w-5", slide: "left-5" },
} as const;

interface SwitchControlProps {
  rootProps: NativeSwitchProps;
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  transitioning?: boolean;
  size: KumoSwitchSize;
  variant: SwitchVariant;
  class?: string;
  className?: string;
  fallbackLabel?: string;
  item?: boolean;
  ref?: SwitchRef;
}

function setRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    (ref as (value: T) => void)(value);
    return;
  }
  if (ref && typeof ref === "object" && "current" in ref) {
    (ref as { current: T }).current = value;
  }
}

function callEventHandler<T, E extends Event>(
  handler: JSX.EventHandlerUnion<T, E> | undefined,
  event: E & { currentTarget: T; target: Element },
) {
  if (!handler) return;
  if (typeof handler === "function") {
    handler(event);
  } else {
    handler[0](handler[1], event);
  }
}

function SwitchControl(props: SwitchControlProps) {
  const [buttonProps, rootProps] = splitProps(props.rootProps, [
    "aria-label",
    "name",
    "onClick",
    "role",
    "value",
  ]);
  const generatedId = createUniqueId();
  const id = () => props.id ?? `kumo-switch-${generatedId}`;
  const [uncontrolledChecked, setUncontrolledChecked] = createSignal(
    Boolean(props.defaultChecked),
  );
  const checked = () =>
    props.checked === undefined
      ? uncontrolledChecked()
      : Boolean(props.checked);
  const role = () => buttonProps.role ?? "switch";
  const sizeStyles = () => SWITCH_SIZE_STYLES[props.size];
  const isNeutral = () => props.variant === "neutral";
  const trackColors = () =>
    isNeutral()
      ? checked()
        ? "bg-kumo-switch-neutral-track-checked ring-kumo-switch-neutral-ring-checked"
        : "bg-kumo-switch-neutral-track ring-kumo-hairline"
      : checked()
        ? "bg-kumo-switch-track-checked ring-kumo-switch-ring-checked"
        : "bg-kumo-switch-track ring-kumo-switch-ring";
  const thumbColors = () =>
    checked()
      ? isNeutral()
        ? "bg-kumo-switch-neutral-thumb-checked"
        : "bg-kumo-switch-thumb-checked"
      : "bg-kumo-base";
  const squircleRadius =
    "rounded-[5px] supports-[corner-shape:squircle]:rounded-[10px] [corner-shape:squircle]";

  return (
    <>
      <button
        {...rootProps}
        ref={(element) => setRef(props.ref, element)}
        id={id()}
        data-kumo-component="Switch"
        data-kumo-part={props.item ? "item" : undefined}
        data-checked={checked() ? "" : undefined}
        data-unchecked={checked() ? undefined : ""}
        data-disabled={props.disabled ? "" : undefined}
        type="button"
        role={role()}
        disabled={props.disabled}
        aria-label={buttonProps["aria-label"] ?? props.fallbackLabel}
        aria-checked={role() === "switch" ? checked() : undefined}
        aria-pressed={role() === "switch" ? undefined : checked()}
        aria-readonly={props.readOnly || undefined}
        aria-required={props.required || undefined}
        aria-busy={props.transitioning || undefined}
        class={cn(
          "relative inline-flex cursor-pointer items-center border-none p-0 ring",
          props.item
            ? "focus:ring-kumo-focus/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
            : "focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
          "transition-colors duration-150 ease-out motion-reduce:transition-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          sizeStyles().track,
          squircleRadius,
          trackColors(),
          props.class,
          props.className,
        )}
        onClick={(event) => {
          callEventHandler(buttonProps.onClick, event);
          if (event.defaultPrevented || props.disabled || props.readOnly) {
            return;
          }
          const nextChecked = !checked();
          if (props.checked === undefined) {
            setUncontrolledChecked(nextChecked);
          }
          props.onCheckedChange?.(nextChecked);
        }}
      >
        <div
          class={cn(
            "absolute top-0 bottom-0 shadow-[0_0_1px_0.5px_var(--color-kumo-shadow-edge),0_1px_2px_var(--color-kumo-shadow-drop)]",
            sizeStyles().thumb,
            squircleRadius,
            thumbColors(),
            "transition-all duration-150 ease-out motion-reduce:transition-none",
            checked() ? sizeStyles().slide : "left-0",
          )}
        />
      </button>
      {!checked() && buttonProps.name && (
        <input
          type="hidden"
          name={buttonProps.name}
          value="off"
          form={rootProps.form}
        />
      )}
      <input
        id={buttonProps.name ? undefined : `${id()}-input`}
        class="sr-only"
        tabIndex={-1}
        type="checkbox"
        aria-hidden="true"
        name={buttonProps.name}
        value={buttonProps.value ?? "on"}
        form={rootProps.form}
        checked={checked()}
        disabled={props.disabled}
        required={props.required}
        readOnly
      />
    </>
  );
}

function SwitchBase(inputProps: SwitchProps) {
  const [props, rootProps] = splitProps(inputProps, [
    "class",
    "className",
    "checked",
    "defaultChecked",
    "disabled",
    "id",
    "size",
    "variant",
    "label",
    "labelTooltip",
    "required",
    "readOnly",
    "controlFirst",
    "onCheckedChange",
    "transitioning",
    "ref",
  ]);
  const size = () => props.size ?? KUMO_SWITCH_DEFAULT_VARIANTS.size;
  const variant = () => props.variant ?? KUMO_SWITCH_DEFAULT_VARIANTS.variant;
  const generatedId = createUniqueId();
  const id = () => props.id ?? `kumo-switch-${generatedId}`;
  const fallbackLabel = () => (props.label ? undefined : "Switch");
  const control = () => (
    <SwitchControl
      rootProps={rootProps}
      id={id()}
      ref={props.ref}
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      onCheckedChange={props.onCheckedChange}
      transitioning={props.transitioning}
      size={size()}
      variant={variant()}
      class={props.class}
      className={props.className}
      fallbackLabel={fallbackLabel()}
    />
  );

  return (
    <>
      {props.label ? (
        <Field
          htmlFor={id()}
          label={props.label}
          required={props.required}
          labelTooltip={props.labelTooltip}
          controlFirst={props.controlFirst ?? true}
        >
          {control()}
        </Field>
      ) : (
        control()
      )}
    </>
  );
}

function SwitchItem(props: SwitchItemProps) {
  const group = useContext(SwitchGroupContext);

  return (
    <label
      data-kumo-component="Switch"
      data-kumo-part="item-label"
      class={cn(
        "relative m-0 inline-flex items-center gap-2",
        !group.controlFirst && "flex-row-reverse justify-end",
        props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        props.className,
      )}
    >
      <SwitchControl
        rootProps={{ name: props.name }}
        ref={props.ref}
        checked={props.checked}
        defaultChecked={props.defaultChecked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
        transitioning={props.transitioning}
        size={props.size ?? KUMO_SWITCH_DEFAULT_VARIANTS.size}
        variant={props.variant ?? KUMO_SWITCH_DEFAULT_VARIANTS.variant}
        item
      />
      <span class="text-base font-medium text-kumo-default">{props.label}</span>
    </label>
  );
}

function SwitchLegend(props: SwitchLegendProps) {
  return (
    <Fieldset.Legend
      class={cn("text-base font-medium text-kumo-default", props.className)}
    >
      {props.children}
    </Fieldset.Legend>
  );
}

function SwitchGroup(props: SwitchGroupProps) {
  const contextValue: SwitchGroupContextValue = {
    get controlFirst() {
      return props.controlFirst ?? true;
    },
  };

  return (
    <SwitchGroupContext.Provider value={contextValue}>
      <Fieldset.Root
        class={cn("flex flex-col gap-4", props.className)}
        disabled={props.disabled}
      >
        {props.legend && (
          <Fieldset.Legend class="text-base font-medium text-kumo-default">
            {props.legend}
          </Fieldset.Legend>
        )}
        <div class="flex flex-col gap-2">{props.children}</div>
        {props.error && <p class="text-sm text-kumo-danger">{props.error}</p>}
        {props.description && (
          <p class="text-sm text-kumo-subtle">{props.description}</p>
        )}
      </Fieldset.Root>
    </SwitchGroupContext.Provider>
  );
}

type SwitchComponent = typeof SwitchBase & {
  Item: typeof SwitchItem;
  Group: typeof SwitchGroup;
  Legend: typeof SwitchLegend;
};

export const Switch = Object.assign(SwitchBase, {
  Item: SwitchItem,
  Group: SwitchGroup,
  Legend: SwitchLegend,
}) as SwitchComponent;
