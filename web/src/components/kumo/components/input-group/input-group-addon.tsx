import { splitProps, type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import {
  deferInputGroupPart,
  hasDirectInputGroupButton,
  INPUT_GROUP_SIZE,
  InputGroupAddonContext,
  useInputGroupContext,
} from "./context";

export interface InputGroupAddonProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children" | "class" | "className"
> {
  align?: "start" | "end";
  children?: JSX.Element;
  class?: string;
  className?: string;
}

export function Addon(inputProps: InputGroupAddonProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "align",
    "children",
    "class",
    "className",
    "ref",
  ]);

  return deferInputGroupPart(
    () => {
      const context = useInputGroupContext("Addon");
      const size = () => context?.size ?? "base";
      const tokens = () => INPUT_GROUP_SIZE[size()];
      const align = () => props.align ?? "start";
      const rawChildren = () => props.children;
      const containsButton = () => hasDirectInputGroupButton(rawChildren());

      return (
        <InputGroupAddonContext.Provider value={true}>
          <div
            {...elementProps}
            ref={props.ref}
            data-slot={
              align() === "start"
                ? "input-group-addon-start"
                : "input-group-addon-end"
            }
            class={cn(
              "pointer-events-none relative z-[1] flex shrink-0 items-center gap-1.5",
              "text-kumo-subtle",
              tokens().fontSize,
              tokens().iconClass,
              "*:pointer-events-auto",
              align() === "start"
                ? cn(
                    "-order-1",
                    containsButton()
                      ? tokens().addonButtonOuterStart
                      : tokens().addonOuterStart,
                    "pr-0",
                  )
                : cn(
                    "order-1",
                    "pl-0",
                    containsButton()
                      ? tokens().addonButtonOuterEnd
                      : tokens().addonOuterEnd,
                  ),
              props.class,
              props.className,
            )}
          >
            {rawChildren()}
          </div>
        </InputGroupAddonContext.Provider>
      );
    },
    { kind: "addon" },
  );
}
