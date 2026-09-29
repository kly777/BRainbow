import { splitProps, type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import {
  deferInputGroupPart,
  INPUT_GROUP_SIZE,
  useInputGroupContext,
} from "./context";

export interface InputGroupSuffixProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children" | "class" | "className"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
}

export function Suffix(inputProps: InputGroupSuffixProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "ref",
  ]);

  return deferInputGroupPart(
    () => {
      const context = useInputGroupContext("Suffix");
      const size = () => context?.size ?? "base";
      const tokens = () => INPUT_GROUP_SIZE[size()];

      return (
        <div
          {...elementProps}
          ref={props.ref}
          data-slot="input-group-suffix"
          class={cn(
            "pointer-events-none flex min-w-0 grow items-center text-kumo-subtle select-none",
            tokens().fontSize,
            tokens().suffixPad,
            props.class,
            props.className,
          )}
        >
          <span class="truncate">{props.children}</span>
        </div>
      );
    },
    { kind: "suffix" },
  );
}
