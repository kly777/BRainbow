import { Field as FieldBase } from "@photon-ai/base-ui-solid/field";
import { type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import { Label } from "../label";

export type FieldErrorMatch =
  | boolean
  | "badInput"
  | "customError"
  | "patternMismatch"
  | "rangeOverflow"
  | "rangeUnderflow"
  | "stepMismatch"
  | "tooLong"
  | "tooShort"
  | "typeMismatch"
  | "valid"
  | "valueMissing";

export function normalizeFieldError(
  error: string | { message: JSX.Element; match: FieldErrorMatch } | undefined,
): { message: JSX.Element; match: FieldErrorMatch } | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return { message: error, match: true };
  return error;
}

export const KUMO_FIELD_VARIANTS = {} as const;
export const KUMO_FIELD_DEFAULT_VARIANTS = {} as const;

export interface KumoFieldVariantsProps {
  controlFirst?: boolean;
}

export function fieldVariants({
  controlFirst = false,
}: KumoFieldVariantsProps = {}) {
  return cn(
    "grid gap-2",
    "has-[input[type=checkbox]]:grid-cols-[auto_1fr] has-[input[type=checkbox]]:items-center",
    "has-[[role=switch]]:grid-cols-[auto_1fr] has-[[role=switch]]:items-center",
    controlFirst && [
      "has-[input[type=checkbox]]:flex has-[input[type=checkbox]]:flex-row-reverse has-[input[type=checkbox]]:flex-wrap has-[input[type=checkbox]]:items-center",
      "has-[[role=switch]]:flex has-[[role=switch]]:flex-row-reverse has-[[role=switch]]:flex-wrap has-[[role=switch]]:items-center",
      "[&>label]:flex-1",
    ],
  );
}

export interface FieldProps extends KumoFieldVariantsProps {
  children: JSX.Element;
  label: JSX.Element;
  required?: boolean;
  labelTooltip?: JSX.Element;
  error?: {
    message: JSX.Element;
    match: FieldErrorMatch;
  };
  description?: JSX.Element;
  controlFirst?: boolean;
  hideLabel?: boolean;
  htmlFor?: string;
}

export function Field(props: FieldProps) {
  const showOptional = () => props.required === false;
  const controlFirst = () => props.controlFirst ?? false;
  const hideLabel = () => props.hideLabel ?? false;

  return (
    <FieldBase.Root class={fieldVariants({ controlFirst: controlFirst() })}>
      {!hideLabel() && (
        <FieldBase.Label
          for={props.htmlFor}
          class="m-0 text-base font-medium text-kumo-default select-none"
        >
          <Label
            showOptional={showOptional()}
            tooltip={props.labelTooltip}
            asContent
          >
            {props.label}
          </Label>
        </FieldBase.Label>
      )}
      {props.children}
      {props.error ? (
        <FieldBase.Error
          class={cn("text-sm leading-snug text-kumo-danger", "col-span-full")}
          match={props.error.match}
        >
          {props.error.message}
        </FieldBase.Error>
      ) : (
        props.description && (
          <FieldBase.Description
            class={cn("text-sm leading-snug text-kumo-subtle", "col-span-full")}
          >
            {props.description}
          </FieldBase.Description>
        )
      )}
    </FieldBase.Root>
  );
}
