import { mergeProps as mergeBaseUIProps } from "@photon-ai/base-ui-solid/merge-props";
import { useRender } from "@photon-ai/base-ui-solid/use-render";
import { children, splitProps, type JSX } from "solid-js";
import { cn } from "../../utils/cn";

const LAYER_CARD_SURFACE_CLASSES =
  "overflow-hidden rounded-lg bg-kumo-base shadow-xs ring ring-kumo-line";
const LAYER_CARD_LAYERED_ROOT_CLASSES =
  "flex w-full flex-col overflow-hidden rounded-lg bg-kumo-elevated text-base ring ring-kumo-hairline";
const LAYER_CARD_SECONDARY_CLASSES =
  "-my-2 flex items-center gap-2 bg-kumo-elevated p-4 text-base font-medium text-kumo-subtle";
const LAYER_CARD_PRIMARY_CLASSES =
  "relative flex flex-col gap-2 overflow-hidden rounded-lg bg-kumo-base p-4 pr-3 text-inherit no-underline ring ring-kumo-fill";

const LAYER_CARD_SECTION = Symbol("kumo.layer-card.section");

type MarkedLayerCardSection = {
  [LAYER_CARD_SECTION]?: true;
};

export const KUMO_LAYER_CARD_VARIANTS = {} as const;
export const KUMO_LAYER_CARD_DEFAULT_VARIANTS = {} as const;

export interface KumoLayerCardVariantsProps {}

export function layerCardVariants(_props: KumoLayerCardVariantsProps = {}) {
  return cn(LAYER_CARD_SURFACE_CLASSES);
}

export type LayerCardProps = Omit<
  useRender.ComponentProps<"div">,
  "children" | "class" | "className" | "render"
> &
  KumoLayerCardVariantsProps & {
    children?: JSX.Element;
    class?: string;
    className?: string;
    render?: useRender.RenderProp;
  };

export interface LayerCardSectionProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children?: JSX.Element;
  className?: string;
}

function markLayerCardSection<T extends JSX.Element>(element: T): T {
  if (
    element !== null &&
    (typeof element === "object" || typeof element === "function")
  ) {
    Object.defineProperty(element, LAYER_CARD_SECTION, {
      configurable: true,
      value: true,
    });
  }
  return element;
}

function hasLayerCardSections(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasLayerCardSections);
  }
  if (typeof value === "function") {
    return hasLayerCardSections(value());
  }
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as MarkedLayerCardSection)[LAYER_CARD_SECTION],
  );
}

function LayerCardRoot(inputProps: LayerCardProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "render",
    "ref",
  ]);
  const resolvedChildren = children(() => props.children);
  const element = useRender({
    get render() {
      return props.render ?? "div";
    },
    ref: props.ref,
    props: mergeBaseUIProps<"div">(
      {
        get class() {
          return cn(
            hasLayerCardSections(resolvedChildren())
              ? LAYER_CARD_LAYERED_ROOT_CLASSES
              : layerCardVariants(),
            props.class,
            props.className,
          );
        },
      },
      elementProps,
    ),
    get children() {
      return resolvedChildren();
    },
  });

  return element();
}

function LayerCardSecondary(inputProps: LayerCardSectionProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "ref",
  ]);
  const element = (
    <div
      {...elementProps}
      ref={props.ref}
      class={cn(LAYER_CARD_SECONDARY_CLASSES, props.class, props.className)}
    >
      {props.children}
    </div>
  );

  return markLayerCardSection(element);
}

function LayerCardPrimary(inputProps: LayerCardSectionProps) {
  const [props, elementProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "ref",
  ]);
  const element = (
    <div
      {...elementProps}
      ref={props.ref}
      class={cn(LAYER_CARD_PRIMARY_CLASSES, props.class, props.className)}
    >
      {props.children}
    </div>
  );

  return markLayerCardSection(element);
}

type LayerCardComponent = typeof LayerCardRoot & {
  Primary: typeof LayerCardPrimary;
  Secondary: typeof LayerCardSecondary;
};

export const LayerCard = Object.assign(LayerCardRoot, {
  Primary: LayerCardPrimary,
  Secondary: LayerCardSecondary,
}) as LayerCardComponent;
