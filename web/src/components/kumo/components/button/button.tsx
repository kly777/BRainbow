import { mergeProps as mergeBaseUIProps } from "@photon-ai/base-ui-solid/merge-props";
import { children, splitProps, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ArrowsClockwiseIcon } from "../../internal/icons";
import { cn } from "../../utils/cn";
import { useLinkComponent } from "../../utils/link-provider";
import { resolveVariant } from "../../utils/resolve-variant";
import { Loader } from "../loader";
import { Tooltip } from "../tooltip";

export const KUMO_BUTTON_VARIANTS = {
  shape: {
    base: {
      classes: "",
      description: "Default rectangular button shape",
    },
    square: {
      classes: "items-center justify-center p-0",
      description: "Square button for icon-only actions",
    },
    circle: {
      classes: "items-center justify-center p-0 rounded-full",
      description: "Circular button for icon-only actions",
    },
  },
  size: {
    xs: {
      classes: "h-5 gap-1 rounded-sm px-1.5 text-xs",
      description: "Extra small button for compact UIs",
    },
    sm: {
      classes: "h-6.5 gap-1 rounded-md px-2 text-xs",
      description: "Small button for secondary actions",
    },
    base: {
      classes: "h-9 gap-1.5 rounded-lg px-3 text-base",
      description: "Default button size",
    },
    lg: {
      classes: "h-10 gap-2 rounded-lg px-4 text-base",
      description: "Large button for primary CTAs",
    },
  },
  compactSize: {
    xs: { classes: "size-3.5" },
    sm: { classes: "size-6.5" },
    base: { classes: "size-9" },
    lg: { classes: "size-10" },
  },
  variant: {
    primary: {
      classes:
        "bg-(--kumo-button-emphasis-bg) !text-white ring ring-(--kumo-button-emphasis-ring) focus:ring-(--kumo-button-emphasis-ring) focus-visible:ring-(--kumo-button-emphasis-ring) active:ring-(--kumo-button-emphasis-ring) not-disabled:hover:brightness-110 disabled:opacity-50",
      description: "High-emphasis button for primary actions",
    },
    secondary: {
      classes:
        "bg-kumo-base !text-kumo-default ring not-disabled:hover:bg-kumo-tint disabled:bg-kumo-base/50 disabled:!text-kumo-default/70 ring-kumo-line data-[state=open]:bg-kumo-base",
      description: "Default button style for most actions",
    },
    ghost: {
      classes: "text-kumo-default hover:bg-kumo-tint shadow-none bg-inherit",
      description: "Minimal button with no background",
    },
    destructive: {
      classes:
        "bg-(--kumo-button-emphasis-bg) !text-white ring ring-(--kumo-button-emphasis-ring) focus:ring-(--kumo-button-emphasis-ring) focus-visible:ring-(--kumo-button-emphasis-ring) active:ring-(--kumo-button-emphasis-ring) not-disabled:hover:brightness-110 disabled:opacity-50",
      description: "Danger button for destructive actions like delete",
    },
    "secondary-destructive": {
      classes:
        "bg-kumo-base !text-kumo-danger ring not-disabled:hover:!text-kumo-danger not-disabled:hover:ring-kumo-danger/30 disabled:bg-kumo-base/50 disabled:!text-kumo-danger/70 ring-kumo-line data-[state=open]:bg-kumo-base",
      description:
        "Secondary button with destructive text for less prominent dangerous actions",
    },
    outline: {
      classes:
        "bg-transparent text-kumo-default ring ring-kumo-line transition-colors not-disabled:hover:text-kumo-strong not-disabled:hover:ring-kumo-focus/25",
      description: "Bordered button with transparent background",
    },
  },
} as const;

export const KUMO_BUTTON_DEFAULT_VARIANTS = {
  shape: "base",
  size: "base",
  variant: "secondary",
} as const;

export type KumoButtonShape = keyof typeof KUMO_BUTTON_VARIANTS.shape;
export type KumoButtonSize = keyof typeof KUMO_BUTTON_VARIANTS.size;
export type KumoButtonVariant = keyof typeof KUMO_BUTTON_VARIANTS.variant;

export interface KumoButtonVariantsProps {
  shape?: KumoButtonShape;
  size?: KumoButtonSize;
  variant?: KumoButtonVariant;
}

export function buttonVariants({
  variant = KUMO_BUTTON_DEFAULT_VARIANTS.variant,
  size = KUMO_BUTTON_DEFAULT_VARIANTS.size,
  shape = KUMO_BUTTON_DEFAULT_VARIANTS.shape,
}: KumoButtonVariantsProps = {}) {
  const isCompactShape = shape === "square" || shape === "circle";

  return cn(
    "group flex w-max shrink-0 items-center font-medium select-none",
    "border-0 shadow-xs",
    "focus:ring-kumo-focus/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
    "cursor-pointer",
    "disabled:cursor-not-allowed disabled:text-kumo-subtle",
    resolveVariant(
      KUMO_BUTTON_VARIANTS.size,
      size,
      KUMO_BUTTON_DEFAULT_VARIANTS.size,
    ).classes,
    resolveVariant(
      KUMO_BUTTON_VARIANTS.shape,
      shape,
      KUMO_BUTTON_DEFAULT_VARIANTS.shape,
    ).classes,
    isCompactShape &&
      resolveVariant(
        KUMO_BUTTON_VARIANTS.compactSize,
        size,
        KUMO_BUTTON_DEFAULT_VARIANTS.size,
      ).classes,
    resolveVariant(
      KUMO_BUTTON_VARIANTS.variant,
      variant,
      KUMO_BUTTON_DEFAULT_VARIANTS.variant,
    ).classes,
  );
}

type ButtonIcon = Component | JSX.Element;
type ButtonRef = JSX.ButtonHTMLAttributes<HTMLButtonElement>["ref"];
type AnchorRef = JSX.AnchorHTMLAttributes<HTMLAnchorElement>["ref"];
type ButtonStyle = JSX.ButtonHTMLAttributes<HTMLButtonElement>["style"];
type AnchorStyle = JSX.AnchorHTMLAttributes<HTMLAnchorElement>["style"];

const getEmphasisToken = (variant: KumoButtonVariant) => {
  if (variant === "primary") return "var(--color-kumo-brand)";
  if (variant === "destructive") return "var(--color-kumo-danger)";
  return undefined;
};

const getEmphasisStyle = (
  variant: KumoButtonVariant,
): JSX.CSSProperties | undefined => {
  const token = getEmphasisToken(variant);
  if (!token) return undefined;

  // 平涂（本仓库的口径，与上游有一处差异）：底色直接用令牌本身。
  // 上游这里是「color-mix 调浅的底 + 一层竖向渐变 + 内高光」三层叠出来的立体感，
  // 本仓库不要渐变，所以只留一个纯色变量，渐变与内高光在 ButtonContent 里也已去掉。
  return {
    "--kumo-button-emphasis-ring": `color-mix(in oklch, ${token}, black 10%)`,
    "--kumo-button-emphasis-bg": token,
  } as JSX.CSSProperties;
};

const mergeEmphasisStyle = (
  emphasis: JSX.CSSProperties | undefined,
  style: ButtonStyle,
): ButtonStyle => {
  if (!emphasis) return style;
  if (typeof style === "string") {
    const variables = Object.entries(emphasis)
      .map(([name, value]) => `${name}:${String(value)}`)
      .join(";");
    return `${variables};${style}`;
  }
  return { ...emphasis, ...style };
};

const getTitleLabel = (title: JSX.Element) => {
  if (typeof title === "string") return title;
  if (typeof title === "number") return String(title);
  return undefined;
};

type NativeButtonProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "class" | "className" | "disabled" | "ref" | "style" | "title"
>;

type ButtonBaseProps = NativeButtonProps & {
  children?: JSX.Element;
  className?: string;
  disabled?: boolean;
  icon?: ButtonIcon;
  loading?: boolean;
  ref?: ButtonRef;
  style?: ButtonStyle;
  title?: JSX.Element;
};

type ButtonWithTextProps = ButtonBaseProps & {
  shape?: "base";
  size?: KumoButtonSize;
  variant?: KumoButtonVariant;
};

type IconOnlyButtonAccessibleNameProps =
  | {
      "aria-label": string;
      "aria-labelledby"?: string;
    }
  | {
      "aria-label"?: string;
      "aria-labelledby": string;
    }
  | {
      title: string | number;
      "aria-label"?: string;
      "aria-labelledby"?: string;
    };

type IconOnlyButtonProps = ButtonBaseProps &
  IconOnlyButtonAccessibleNameProps & {
    shape: "square" | "circle";
    size?: KumoButtonSize;
    variant?: KumoButtonVariant;
  };

export type ButtonProps = ButtonWithTextProps | IconOnlyButtonProps;

export type RefreshButtonProps = Omit<
  IconOnlyButtonProps,
  "children" | "icon" | "shape"
>;

export type LinkButtonProps = Omit<
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "class" | "className" | "ref" | "style" | "title"
> &
  KumoButtonVariantsProps & {
    children?: JSX.Element;
    className?: string;
    disabled?: boolean;
    external?: boolean;
    icon?: ButtonIcon;
    linksExternal?: boolean;
    ref?: AnchorRef;
    style?: AnchorStyle;
    title?: JSX.Element;
  };

function hasRenderableChildren(value: JSX.Element) {
  if (value == null || value === false) return false;
  return !Array.isArray(value) || value.length > 0;
}

function renderIcon(icon: ButtonIcon | undefined) {
  if (typeof icon === "function") {
    return <Dynamic component={icon as Component} />;
  }
  return icon;
}

function ButtonContent(props: {
  children: JSX.Element;
  icon: ButtonIcon | undefined;
  loading: boolean;
  size: KumoButtonSize;
  variant: KumoButtonVariant;
}) {
  const icon = () =>
    props.loading ? (
      <Loader size={props.size === "lg" ? 16 : 14} />
    ) : (
      renderIcon(props.icon)
    );
  const child = () =>
    hasRenderableChildren(props.children) ? (
      <span class="contents">{props.children}</span>
    ) : null;

  return (
    <>
      {getEmphasisToken(props.variant) ? (
        // 平涂：底色由 --kumo-button-emphasis-bg 给（纯色令牌），不再叠渐变与内高光
        <span class="flex items-center gap-1.5">
          {icon()}
          {child()}
        </span>
      ) : (
        <>
          {icon()}
          {child()}
        </>
      )}
    </>
  );
}

export function Button(inputProps: ButtonProps) {
  const [props, rest] = splitProps(inputProps, [
    "children",
    "className",
    "disabled",
    "loading",
    "shape",
    "size",
    "variant",
    "icon",
    "style",
    "title",
    "type",
    "ref",
    "aria-label",
    "aria-labelledby",
  ]);
  const resolvedChildren = children(() => props.children);
  const shape = () => props.shape ?? KUMO_BUTTON_DEFAULT_VARIANTS.shape;
  const size = () => props.size ?? KUMO_BUTTON_DEFAULT_VARIANTS.size;
  const variant = () => props.variant ?? KUMO_BUTTON_DEFAULT_VARIANTS.variant;
  const titleLabel = () => getTitleLabel(props.title);
  const className = () =>
    cn(
      buttonVariants({
        variant: variant(),
        size: size(),
        shape: shape(),
      }),
      props.disabled && "cursor-not-allowed opacity-50",
      props.className,
    );
  const style = () => {
    const emphasis = getEmphasisStyle(variant());
    return mergeEmphasisStyle(emphasis, props.style);
  };
  const ariaLabel = () =>
    props["aria-label"] ??
    (!hasRenderableChildren(resolvedChildren()) &&
    !props["aria-labelledby"] &&
    titleLabel()
      ? titleLabel()
      : undefined);

  const renderButton = (
    triggerProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  ) => {
    const internalProps = {
      get ref() {
        return props.ref;
      },
      "data-kumo-component": "Button",
      get class() {
        return className();
      },
      get disabled() {
        return Boolean(props.loading || props.disabled);
      },
      get style() {
        return style();
      },
      get type() {
        return props.type ?? "button";
      },
      get "aria-label"() {
        return ariaLabel();
      },
      get "aria-labelledby"() {
        return props["aria-labelledby"];
      },
    } as JSX.ButtonHTMLAttributes<HTMLButtonElement>;
    const elementProps = mergeBaseUIProps([internalProps, rest, triggerProps]);

    return (
      <button {...elementProps}>
        <ButtonContent
          children={resolvedChildren()}
          icon={props.icon}
          loading={props.loading ?? false}
          size={size()}
          variant={variant()}
        />
      </button>
    );
  };

  return (
    <>
      {props.title ? (
        props.disabled || props.loading ? (
          <Tooltip
            content={props.title}
            render={(triggerProps) => (
              <span
                {...mergeBaseUIProps([{ class: "inline-flex" }, triggerProps])}
              >
                {renderButton()}
              </span>
            )}
          />
        ) : (
          <Tooltip
            content={props.title}
            render={(triggerProps) =>
              renderButton(
                triggerProps as JSX.ButtonHTMLAttributes<HTMLButtonElement>,
              )
            }
          />
        )
      ) : (
        renderButton()
      )}
    </>
  );
}

export function RefreshButton(inputProps: RefreshButtonProps) {
  const [props, rest] = splitProps(inputProps, ["aria-label", "loading"]);

  return (
    <Button
      shape="square"
      aria-label={props["aria-label"] ?? "Refresh"}
      {...rest}
    >
      <ArrowsClockwiseIcon
        class={cn(
          props.loading && "animate-refresh",
          (!rest.size || rest.size === "base") && "size-4.5",
          rest.size === "sm" && "size-4",
          rest.size === "lg" && "size-5",
        )}
      />
    </Button>
  );
}

const ANCHOR_ONLY_PROPS = new Set([
  "href",
  "target",
  "rel",
  "download",
  "hrefLang",
  "hreflang",
  "media",
  "ping",
  "referrerPolicy",
  "referrerpolicy",
  "linksExternal",
]);

function toDisabledButtonProps(
  source: Record<string, unknown>,
): JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  const result = { ...source };
  for (const key of Object.keys(result)) {
    if (key.startsWith("on") || ANCHOR_ONLY_PROPS.has(key)) {
      delete result[key];
    }
  }
  return result as JSX.ButtonHTMLAttributes<HTMLButtonElement>;
}

export function LinkButton(inputProps: LinkButtonProps) {
  const [props, rest] = splitProps(inputProps, [
    "children",
    "className",
    "disabled",
    "external",
    "href",
    "shape",
    "size",
    "variant",
    "icon",
    "style",
    "title",
    "ref",
  ]);
  const LinkComponent = useLinkComponent();
  const resolvedChildren = children(() => props.children);
  const shape = () => props.shape ?? KUMO_BUTTON_DEFAULT_VARIANTS.shape;
  const size = () => props.size ?? KUMO_BUTTON_DEFAULT_VARIANTS.size;
  const variant = () => props.variant ?? "ghost";
  const className = () =>
    cn(
      buttonVariants({
        variant: variant(),
        size: size(),
        shape: shape(),
      }),
      "flex items-center no-underline!",
      props.className,
    );
  const style = () => {
    const emphasis = getEmphasisStyle(variant());
    return mergeEmphasisStyle(emphasis, props.style);
  };

  const renderLink = (
    triggerProps?: JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
  ) => {
    const internalProps = {
      get ref() {
        return props.ref;
      },
      "data-kumo-component": "LinkButton",
      get class() {
        return className();
      },
      get href() {
        return props.href;
      },
      get to() {
        return typeof props.href === "string" ? props.href : undefined;
      },
      get style() {
        return style();
      },
    } as JSX.AnchorHTMLAttributes<HTMLAnchorElement> & {
      to?: string;
    };
    const externalProps = () =>
      props.external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : undefined;
    const elementProps = mergeBaseUIProps([
      internalProps,
      externalProps(),
      rest,
      triggerProps,
    ]);

    return (
      <Dynamic component={LinkComponent} {...elementProps}>
        <ButtonContent
          children={resolvedChildren()}
          icon={props.icon}
          loading={false}
          size={size()}
          variant={variant()}
        />
      </Dynamic>
    );
  };

  return (
    <>
      {props.disabled ? (
        <Button
          {...toDisabledButtonProps(rest as Record<string, unknown>)}
          className={props.className}
          data-kumo-component="LinkButton"
          disabled
          icon={props.icon}
          shape={shape() as "base"}
          size={size()}
          style={props.style}
          title={props.title}
          variant={variant()}
        >
          {resolvedChildren()}
        </Button>
      ) : props.title ? (
        <Tooltip
          content={props.title}
          render={(triggerProps) =>
            renderLink(
              triggerProps as JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
            )
          }
        />
      ) : (
        renderLink()
      )}
    </>
  );
}
