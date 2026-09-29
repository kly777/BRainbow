import { mergeProps as mergeBaseUIProps } from "@photon-ai/base-ui-solid/merge-props";
import { Toolbar as ToolbarBase } from "@photon-ai/base-ui-solid/toolbar";
import { splitProps, useContext, type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import { Input as InputExternal, type InputProps } from "../input";
import {
  deferInputGroupPart,
  INPUT_GROUP_SIZE,
  InputGroupToolbarContext,
  useInputGroupContext,
} from "./context";

export type InputGroupInputProps = Omit<
  InputProps,
  "description" | "disabled" | "error" | "label" | "labelTooltip" | "size"
>;

export function Input(inputProps: InputGroupInputProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "class",
    "className",
    "id",
    "aria-invalid",
  ]);

  return deferInputGroupPart(
    () => {
      const context = useInputGroupContext("Input");
      const toolbar = useContext(InputGroupToolbarContext);
      const rawProps = inputProps as InputGroupInputProps & {
        description?: unknown;
        disabled?: boolean;
        label?: unknown;
        size?: unknown;
      };

      if (import.meta.env?.DEV && context) {
        if (rawProps.size !== undefined) {
          console.warn(
            "InputGroup.Input: Set `size` on <InputGroup> instead of <InputGroup.Input>.",
          );
        }
        if (rawProps.disabled !== undefined) {
          console.warn(
            "InputGroup.Input: Set `disabled` on <InputGroup> instead of <InputGroup.Input>.",
          );
        }
        if (rawProps.label !== undefined) {
          console.warn(
            "InputGroup.Input: Use the `label` prop on <InputGroup> instead of <InputGroup.Input>.",
          );
        }
        if (rawProps.description !== undefined) {
          console.warn(
            "InputGroup.Input: Use <InputGroup.Suffix> instead of passing `description` to <InputGroup.Input>.",
          );
        }
      }

      const size = () => context?.size ?? "base";
      const tokens = () => INPUT_GROUP_SIZE[size()];
      const isIndividual = () => context?.focusMode === "individual";
      const hasError = () => Boolean(context?.error);
      const inputId = () => props.id ?? context?.inputId;
      const contextLabel = () =>
        typeof context?.label === "string" ? context.label : undefined;

      const renderInput = (
        toolbarProps?: JSX.InputHTMLAttributes<HTMLInputElement>,
      ) => {
        const mergedElementProps = toolbarProps
          ? mergeBaseUIProps<"input">([
              elementProps as JSX.InputHTMLAttributes<HTMLInputElement>,
              toolbarProps,
            ])
          : elementProps;

        return (
          <InputExternal
            {...(mergedElementProps as InputGroupInputProps)}
            size={size()}
            disabled={Boolean(
              context?.disabled || rawProps.disabled || toolbarProps?.disabled,
            )}
            aria-invalid={hasError() || props["aria-invalid"]}
            aria-label={
              elementProps["aria-label"] ?? contextLabel() ?? toolbar?.ariaLabel
            }
            aria-labelledby={
              elementProps["aria-labelledby"] ?? toolbar?.ariaLabelledBy
            }
            id={inputId()}
            class={cn(
              "flex h-full min-w-0 grow items-center rounded-none border-0 bg-transparent font-sans",
              tokens().inputOuter,
              "text-ellipsis",
              isIndividual()
                ? [
                    "relative ring-0 focus:ring-0 border border-kumo-line",
                    "first:rounded-l-[inherit] last:rounded-r-[inherit]",
                    "not-first:-ml-px",
                    "hover:z-1 hover:border-kumo-line",
                    "focus:z-2 focus:border-kumo-focus/50",
                  ].join(" ")
                : "relative z-1 shadow-none ring-0! outline-none focus:ring-0! focus:outline-none",
              props.class,
              props.className,
            )}
          />
        );
      };

      return toolbar ? (
        <ToolbarBase.Input
          aria-label={
            elementProps["aria-label"] ?? contextLabel() ?? toolbar.ariaLabel
          }
          aria-labelledby={
            elementProps["aria-labelledby"] ?? toolbar.ariaLabelledBy
          }
          disabled={Boolean(context?.disabled || rawProps.disabled)}
          render={(toolbarProps) =>
            renderInput(
              toolbarProps as JSX.InputHTMLAttributes<HTMLInputElement>,
            )
          }
        />
      ) : (
        renderInput()
      );
    },
    { kind: "input" },
  );
}
