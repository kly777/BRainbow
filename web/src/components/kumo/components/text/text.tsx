import { createMemo, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";

export const KUMO_TEXT_VARIANTS = {
  variant: {
    heading1: {
      classes: "text-3xl font-semibold",
      description: "Large heading for page titles",
    },
    heading2: {
      classes: "text-2xl font-semibold",
      description: "Medium heading for section titles",
    },
    heading3: {
      classes: "text-lg font-semibold",
      description: "Small heading for subsections",
    },
    body: {
      classes: "text-kumo-default",
      description: "Default body text",
    },
    secondary: {
      classes: "text-kumo-subtle",
      description: "Muted text for secondary information",
    },
    success: {
      classes: "text-kumo-link",
      description: "Success state text",
    },
    error: {
      classes: "text-kumo-danger",
      description: "Error state text",
    },
    mono: {
      classes: "font-mono",
      description: "Monospace text for code",
    },
    "mono-secondary": {
      classes: "font-mono text-kumo-subtle",
      description: "Muted monospace text",
    },
  },
  size: {
    xs: {
      classes: "text-xs",
      description: "Extra small text",
    },
    sm: {
      classes: "text-sm",
      description: "Small text",
    },
    base: {
      classes: "text-base",
      description: "Default text size",
    },
    lg: {
      classes: "text-lg",
      description: "Large text",
    },
  },
} as const;

export const KUMO_TEXT_DEFAULT_VARIANTS = {
  variant: "body",
  size: "base",
} as const;

export const KUMO_TEXT_STYLING = {
  fontSizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
  },
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
  },
  baseColor: "text-kumo-default",
  variantColors: {
    body: "text-kumo-default",
    secondary: "text-kumo-subtle",
    success: "text-kumo-link",
    error: "text-kumo-danger",
    mono: "text-kumo-default",
    "mono-secondary": "text-kumo-subtle",
  },
  fontFamilies: {
    default: "sans-serif",
    mono: "monospace",
  },
} as const;

export type KumoTextVariant = keyof typeof KUMO_TEXT_VARIANTS.variant;
export type KumoTextSize = keyof typeof KUMO_TEXT_VARIANTS.size;

export interface KumoTextVariantsProps {
  variant?: KumoTextVariant;
  size?: KumoTextSize;
}

export function textVariants({
  variant = KUMO_TEXT_DEFAULT_VARIANTS.variant,
  size = KUMO_TEXT_DEFAULT_VARIANTS.size,
}: KumoTextVariantsProps = {}) {
  return cn(
    resolveVariant(
      KUMO_TEXT_VARIANTS.variant,
      variant,
      KUMO_TEXT_DEFAULT_VARIANTS.variant,
    ).classes,
    resolveVariant(
      KUMO_TEXT_VARIANTS.size,
      size,
      KUMO_TEXT_DEFAULT_VARIANTS.size,
    ).classes,
  );
}

type Heading = "heading1" | "heading2" | "heading3";
type Copy = "body" | "secondary" | "success" | "error";
type Monospace = "mono" | "mono-secondary";
type TextVariant = KumoTextVariant;

export type TextElement =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "span"
  | "label"
  | "dt"
  | "dd"
  | "li"
  | "figcaption"
  | "legend"
  | "pre"
  | "code"
  | "em"
  | "strong"
  | "small"
  | "abbr"
  | "time";

type TextRef = HTMLElement | ((element: HTMLElement) => void);

type BaseTextProps = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  "children" | "class" | "className" | "style" | "ref"
> & {
  children?: JSX.Element;
  DANGEROUS_className?: string;
  DANGEROUS_style?: JSX.CSSProperties;
  ref?: TextRef;
};

type TextPropsInternal<Variant extends TextVariant = "body"> = BaseTextProps &
  (Variant extends Copy
    ? {
        variant?: Variant;
        bold?: boolean;
        size?: KumoTextSize;
        truncate?: boolean;
        as?: TextElement;
      }
    : Variant extends Monospace
      ? {
          variant?: Variant;
          bold?: never;
          size?: "lg";
          truncate?: boolean;
          as?: TextElement;
        }
      : Variant extends Heading
        ? {
            variant: Variant;
            bold?: never;
            size?: never;
            truncate?: boolean;
            as: TextElement;
          }
        : never);

export interface TextProps extends BaseTextProps {
  variant?: KumoTextVariant;
  size?: KumoTextSize;
  bold?: boolean;
  truncate?: boolean;
  as?: TextElement;
}

export function Text<Variant extends TextVariant = "body">(
  inputProps: TextPropsInternal<Variant>,
) {
  const [props, rest] = splitProps(inputProps, [
    "variant",
    "bold",
    "size",
    "truncate",
    "children",
    "DANGEROUS_className",
    "DANGEROUS_style",
    "as",
    "ref",
  ]);

  const variant = () => (props.variant ?? "body") as TextVariant;
  const size = () => (props.size ?? "base") as KumoTextSize;
  const isCopy = () =>
    (["body", "secondary", "success", "error"] as TextVariant[]).includes(
      variant(),
    );
  const isMono = () =>
    (["mono", "mono-secondary"] as TextVariant[]).includes(variant());
  const component = createMemo<TextElement>(() => {
    if (props.as) return props.as;
    if (isMono()) return "span";
    if (
      (["heading1", "heading2", "heading3"] as TextVariant[]).includes(
        variant(),
      )
    ) {
      return "span";
    }
    return "p";
  });

  return (
    <Dynamic
      component={component()}
      ref={props.ref}
      class={cn(
        "text-kumo-default",
        resolveVariant(
          KUMO_TEXT_VARIANTS.variant,
          variant(),
          KUMO_TEXT_DEFAULT_VARIANTS.variant,
        ).classes,
        isCopy()
          ? resolveVariant(
              KUMO_TEXT_VARIANTS.size,
              size(),
              KUMO_TEXT_DEFAULT_VARIANTS.size,
            ).classes
          : "",
        isCopy() && props.bold ? "font-medium" : "",
        isMono() &&
          (size() === "lg"
            ? KUMO_TEXT_VARIANTS.size.base.classes
            : KUMO_TEXT_VARIANTS.size.sm.classes),
        props.truncate && "min-w-0 truncate",
        props.DANGEROUS_className,
      )}
      style={props.DANGEROUS_style}
      {...rest}
    >
      {props.children}
    </Dynamic>
  );
}
