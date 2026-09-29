import { Show, type JSX } from "solid-js";
import { InfoIcon } from "../../internal/icons";
import { cn } from "../../utils/cn";
import { Button, type ButtonProps } from "../button";
import { Tooltip } from "../tooltip";

export const KUMO_LABEL_VARIANTS = {} as const;
export const KUMO_LABEL_DEFAULT_VARIANTS = {} as const;

export interface KumoLabelVariantsProps {}

export function labelVariants(_props: KumoLabelVariantsProps = {}) {
  return cn("m-0 text-base font-medium text-kumo-default");
}

export function labelContentVariants() {
  return cn("inline-flex items-center gap-1");
}

export interface LabelProps extends KumoLabelVariantsProps {
  children: JSX.Element;
  showOptional?: boolean;
  tooltip?: JSX.Element;
  className?: string;
  htmlFor?: string;
  asContent?: boolean;
}

export function Label(props: LabelProps) {
  const content = () => (
    <>
      {props.children}
      <Show when={props.showOptional}>
        <span class="font-normal text-kumo-subtle">(optional)</span>
      </Show>
      <Show when={props.tooltip}>
        {(tooltip) => (
          <Tooltip
            content={tooltip()}
            render={(triggerProps) => (
              <Button
                {...(triggerProps as ButtonProps)}
                variant="ghost"
                size="xs"
                shape="square"
                aria-label="More information"
              >
                <InfoIcon class="size-4" />
              </Button>
            )}
          />
        )}
      </Show>
    </>
  );

  return (
    <Show
      when={props.asContent}
      fallback={
        <label
          for={props.htmlFor}
          class={cn(labelVariants(), labelContentVariants(), props.className)}
        >
          {content()}
        </label>
      }
    >
      <span class={cn(labelContentVariants(), props.className)}>
        {content()}
      </span>
    </Show>
  );
}
