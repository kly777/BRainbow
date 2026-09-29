import { Field as FieldBase } from "@photon-ai/base-ui-solid/field";
import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { cn } from "../../utils/cn";
import {
  Field as KumoField,
  normalizeFieldError,
  type FieldErrorMatch,
} from "../field";
import {
  inputVariants,
  KUMO_INPUT_DEFAULT_VARIANTS,
  type KumoInputSize,
  type KumoInputVariant,
} from "./input";

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type TextareaInputHandler = JSX.EventHandler<HTMLTextAreaElement, InputEvent>;
type TextareaChangeHandler = JSX.EventHandler<HTMLTextAreaElement, Event>;
type TextareaRef = JSX.TextareaHTMLAttributes<HTMLTextAreaElement>["ref"];

type NativeTextareaProps = Omit<
  JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "class" | "onChange" | "onInput" | "ref" | "size"
>;

export type InputAreaProps = NativeTextareaProps & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onInput?: TextareaInputHandler;
  onChange?: TextareaChangeHandler;
  ref?: TextareaRef;
  variant?: KumoInputVariant;
  size?: KumoInputSize;
  class?: string;
  className?: string;
  label?: JSX.Element;
  labelTooltip?: JSX.Element;
  description?: JSX.Element;
  error?: string | { message: JSX.Element; match: FieldErrorMatch };
  autoResize?: boolean;
  minRows?: number;
  maxRows?: number;
};

export function InputArea(inputProps: InputAreaProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "class",
    "className",
    "onValueChange",
    "size",
    "variant",
    "onChange",
    "onInput",
    "label",
    "labelTooltip",
    "description",
    "error",
    "autoResize",
    "minRows",
    "maxRows",
    "rows",
    "ref",
    "defaultValue",
  ]);
  const [textarea, setTextarea] = createSignal<HTMLTextAreaElement>();
  let forwardedRefCleanup: (() => void) | undefined;
  let lastNotifiedValue: string | undefined;

  const size = () => props.size ?? KUMO_INPUT_DEFAULT_VARIANTS.size;
  const variant = () =>
    props.variant ??
    (props.error ? "error" : KUMO_INPUT_DEFAULT_VARIANTS.variant);
  const autoResize = () => props.autoResize ?? false;
  const minRows = () => props.minRows ?? 1;
  const shouldWrap = () =>
    Boolean(props.label || props.error || props.description);
  const isControlled = () => elementProps.value !== undefined;

  if (import.meta.env?.DEV) {
    createEffect(() => {
      if (props.variant === "error") {
        console.warn(
          '[Kumo InputArea]: variant="error" is deprecated. ' +
            "Error styling is now automatically applied when the `error` prop is truthy. " +
            "Simply remove the variant prop and pass an error message instead.",
        );
      }
    });
  }

  const setTextareaRef = (node: HTMLTextAreaElement) => {
    setTextarea(node);
    forwardedRefCleanup?.();
    forwardedRefCleanup = undefined;

    if (typeof props.ref === "function") {
      const cleanup = (props.ref as (element: HTMLTextAreaElement) => unknown)(
        node,
      );
      if (typeof cleanup === "function") {
        forwardedRefCleanup = cleanup as () => void;
      }
    }
  };

  onCleanup(() => {
    forwardedRefCleanup?.();
  });

  const resize = () => {
    const node = textarea();
    if (!autoResize() || !node || typeof window === "undefined") return;

    const style = window.getComputedStyle(node);
    const borders =
      parsePx(style.borderTopWidth) + parsePx(style.borderBottomWidth);
    const padding = parsePx(style.paddingTop) + parsePx(style.paddingBottom);
    const isBorderBox = style.boxSizing === "border-box";

    node.style.height = "auto";
    let height = isBorderBox
      ? node.scrollHeight + borders
      : node.scrollHeight - padding;

    const currentMinRows = minRows();
    const currentMaxRows = props.maxRows;
    if (currentMinRows > 0 || (currentMaxRows && currentMaxRows > 0)) {
      const fontSize = parsePx(style.fontSize);
      const rawLineHeight = style.lineHeight;
      const lineHeight =
        rawLineHeight === "normal" || rawLineHeight === ""
          ? fontSize * 1.2
          : rawLineHeight.endsWith("px")
            ? parsePx(rawLineHeight)
            : parsePx(rawLineHeight) * fontSize;
      const boxSpacing = isBorderBox ? padding + borders : 0;
      const minHeight = lineHeight * currentMinRows + boxSpacing;
      height = Math.max(height, minHeight);

      if (currentMaxRows && currentMaxRows > 0) {
        const maxHeight = lineHeight * currentMaxRows + boxSpacing;
        if (height > maxHeight) {
          height = maxHeight;
          node.style.overflowY = "auto";
        } else {
          node.style.overflowY = "hidden";
        }
      } else {
        node.style.overflowY = "hidden";
      }
    } else {
      node.style.overflowY = "hidden";
    }

    node.style.height = `${height}px`;
  };

  createEffect(() => {
    const resizeState = [
      autoResize(),
      elementProps.value,
      elementProps.style,
      props.class,
      props.className,
      props.defaultValue,
      props.description,
      props.error,
      props.label,
      props.labelTooltip,
      props.size,
      props.variant,
      props.minRows,
      props.maxRows,
    ] as const;
    if (!resizeState[0]) return;

    resize();
  });

  createEffect(() => {
    const node = textarea();
    if (!autoResize() || !node) return;

    let lastWidth = node.clientWidth;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (node.clientWidth !== lastWidth) {
              lastWidth = node.clientWidth;
              resize();
            }
          })
        : undefined;
    observer?.observe(node);

    onCleanup(() => {
      observer?.disconnect();
      node.style.height = "";
      node.style.overflowY = "";
    });
  });

  const notifyValueChange = (value: string) => {
    if (lastNotifiedValue === value) return;
    lastNotifiedValue = value;
    props.onValueChange?.(value);
  };

  const handleInput: TextareaInputHandler = (event) => {
    props.onInput?.(event);
    notifyValueChange(event.currentTarget.value);
    if (!isControlled()) resize();
  };

  const handleChange: TextareaChangeHandler = (event) => {
    props.onChange?.(event);
    notifyValueChange(event.currentTarget.value);
    if (!isControlled()) resize();
  };

  const textareaClass = () =>
    cn(
      inputVariants({
        size: size(),
        variant: variant(),
        focusIndicator: true,
      }),
      "h-auto py-2",
      autoResize() &&
        "field-sizing-content w-full resize-none scroll-pb-2 [scrollbar-color:var(--color-kumo-line)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-kumo-line [&::-webkit-scrollbar-track]:my-2",
      props.class,
      props.className,
    );

  const renderTextarea = (
    controlProps: JSX.HTMLAttributes<HTMLTextAreaElement> = {},
  ) => (
    <textarea
      {...controlProps}
      {...elementProps}
      value={elementProps.value}
      ref={setTextareaRef}
      class={textareaClass()}
      onInput={handleInput}
      onChange={handleChange}
      rows={autoResize() ? minRows() : props.rows}
    >
      {elementProps.value ?? props.defaultValue}
    </textarea>
  );

  return (
    <>
      {shouldWrap() ? (
        <KumoField
          label={props.label}
          required={elementProps.required}
          labelTooltip={props.labelTooltip}
          description={props.description}
          error={normalizeFieldError(props.error)}
        >
          <FieldBase.Control
            render={(controlProps) =>
              renderTextarea(
                controlProps as JSX.HTMLAttributes<HTMLTextAreaElement>,
              )
            }
          />
        </KumoField>
      ) : (
        renderTextarea()
      )}
    </>
  );
}

export const Textarea = InputArea;
