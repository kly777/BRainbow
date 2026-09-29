import { mergeProps as mergeBaseUIProps } from "@photon-ai/base-ui-solid/merge-props";
import { useRender } from "@photon-ai/base-ui-solid/use-render";
import { onMount, splitProps, type JSX } from "solid-js";
import { cn } from "../../utils/cn";
import {
  useLinkComponent,
  type LinkComponentProps,
} from "../../utils/link-provider";
import { resolveVariant } from "../../utils/resolve-variant";

type ExternalIconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  className?: string;
};

function ExternalIcon(inputProps: ExternalIconProps) {
  const [props, svgProps] = splitProps(inputProps, ["class", "className"]);

  return (
    <svg
      {...svgProps}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cn("link-external-icon", props.class, props.className)}
    >
      <path d="M9 4H8.8C7.11984 4 6.27976 4 5.63803 4.32698C5.07354 4.6146 4.6146 5.07354 4.32698 5.63803C4 6.27976 4 7.11984 4 8.8V15.2C4 16.8802 4 17.7202 4.32698 18.362C4.6146 18.9265 5.07354 19.3854 5.63803 19.673C6.27976 20 7.11984 20 8.8 20H15.2C16.8802 20 17.7202 20 18.362 19.673C18.9265 19.3854 19.3854 18.9265 19.673 18.362C20 17.7202 20 16.8802 20 15.2V15" />
      <path d="M14 4H20M20 4V10M20 4L11 13" />
    </svg>
  );
}

export const KUMO_LINK_VARIANTS = {
  variant: {
    inline: {
      classes:
        "text-kumo-link underline underline-offset-[0.15em] decoration-[0.0625em] link-current transition-colors",
      description: "Inline text link that flows with content",
    },
    current: {
      classes:
        "text-current underline underline-offset-[0.15em] decoration-[0.0625em] link-current transition-colors",
      description: "Link that inherits color from parent text",
    },
    plain: {
      classes: "text-kumo-link hover:text-kumo-link/70 transition-colors",
      description: "Link without underline decoration",
    },
  },
} as const;

export const KUMO_LINK_DEFAULT_VARIANTS = {
  variant: "inline",
} as const;

export type KumoLinkVariant = keyof typeof KUMO_LINK_VARIANTS.variant;

export interface KumoLinkVariantsProps {
  variant?: KumoLinkVariant;
}

export function linkVariants({
  variant = KUMO_LINK_DEFAULT_VARIANTS.variant,
}: KumoLinkVariantsProps = {}) {
  return cn(
    resolveVariant(
      KUMO_LINK_VARIANTS.variant,
      variant,
      KUMO_LINK_DEFAULT_VARIANTS.variant,
    ).classes,
  );
}

type AnchorRef = JSX.AnchorHTMLAttributes<HTMLAnchorElement>["ref"];
type LinkRender = useRender.RenderProp;

export type LinkProps = Omit<
  LinkComponentProps,
  "children" | "class" | "className" | "ref"
> &
  KumoLinkVariantsProps & {
    children?: JSX.Element;
    class?: string;
    className?: string;
    ref?: AnchorRef;
    render?: LinkRender;
  };

function LinkBase(inputProps: LinkProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "variant",
    "render",
    "ref",
  ]);
  const LinkComponent = useLinkComponent();
  const variant = () => props.variant ?? KUMO_LINK_DEFAULT_VARIANTS.variant;

  if (import.meta.env?.DEV) {
    onMount(() => {
      if (elementProps.to !== undefined) {
        console.warn(
          "[kumo] Link: The `to` prop is deprecated. Use `href` instead.\n\n" +
            "If your app uses a client-side router, configure a LinkProvider that\n" +
            "maps `href` to your router's navigation prop. See:\n" +
            "https://kumo.cfops.it/utilities/link-provider\n\n" +
            "Migration example:\n" +
            '  Before: <Link to="/page">…</Link>\n' +
            '  After:  <Link href="/page">…</Link>',
        );
      }
    });
  }

  const element = useRender({
    get render() {
      return (props.render ?? {
        component: LinkComponent,
      }) as NonNullable<LinkRender>;
    },
    ref: props.ref,
    props: mergeBaseUIProps<"a">(
      {
        "data-kumo-component": "Link",
        get class() {
          return cn(
            linkVariants({ variant: variant() }),
            "group/link inline-flex items-center gap-[0.1875em]",
            props.class,
            props.className,
          );
        },
      } as JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
      elementProps,
    ),
    get children() {
      return props.children;
    },
  });

  return element();
}

type LinkComponent = typeof LinkBase & {
  ExternalIcon: typeof ExternalIcon;
};

export const Link = Object.assign(LinkBase, {
  ExternalIcon,
}) as LinkComponent;
