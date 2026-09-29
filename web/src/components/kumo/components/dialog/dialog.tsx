import { AlertDialog as AlertDialogBase } from "@photon-ai/base-ui-solid/alert-dialog";
import { Dialog as DialogBase } from "@photon-ai/base-ui-solid/dialog";
import {
  createContext,
  Show,
  splitProps,
  useContext,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { cn } from "../../utils/cn";
import {
  usePortalContainerAccessor,
  type PortalContainer,
} from "../../utils/portal-provider";
import { resolveVariant } from "../../utils/resolve-variant";
import { LayerCard } from "../layer-card";

/** Dialog size and role variant definitions. */
export const KUMO_DIALOG_VARIANTS = {
  size: {
    base: {
      classes: "sm:w-96",
      description: "Default dialog width (384px)",
    },
    sm: {
      classes: "sm:w-72",
      description: "Small dialog for simple confirmations (288px)",
    },
    lg: {
      classes: "sm:w-[32rem]",
      description: "Large dialog for complex content (512px)",
    },
    xl: {
      classes: "sm:w-[48rem]",
      description: "Extra large dialog for detailed views (768px)",
    },
  },
  role: {
    dialog: {
      classes: "",
      description: "Standard dialog for general-purpose modals",
    },
    alertdialog: {
      classes: "",
      description:
        "Alert dialog for confirmation flows requiring explicit user acknowledgment",
    },
  },
} as const;

export const KUMO_DIALOG_DEFAULT_VARIANTS = {
  size: "base",
  role: "dialog",
} as const;

export const KUMO_DIALOG_STYLING = {
  dimensions: {
    sm: {
      width: 350,
      titleSize: 20,
      descSize: 16,
      padding: 16,
      gap: 8,
      buttonSize: "sm",
    },
    base: {
      width: 384,
      titleSize: 20,
      descSize: 16,
      padding: 24,
      gap: 16,
      buttonSize: "base",
    },
    lg: {
      width: 512,
      titleSize: 20,
      descSize: 16,
      padding: 24,
      gap: 16,
      buttonSize: "base",
    },
    xl: {
      width: 768,
      titleSize: 20,
      descSize: 16,
      padding: 24,
      gap: 16,
      buttonSize: "base",
    },
  },
  baseTokens: {
    background: "color-surface",
    text: "text-color-surface",
    borderRadius: 12,
    shadow: "shadow-m",
  },
  backdrop: {
    background: "color-surface-secondary",
    opacity: 0.8,
  },
  header: {
    title: { fontWeight: 600, color: "text-color-surface" },
    closeIcon: { name: "ph-x", size: 20, color: "text-color-muted" },
  },
  description: {
    fontWeight: 400,
    color: "text-color-muted",
  },
  buttons: {
    primary: { background: "color-primary", text: "white" },
    secondary: { ring: "color-border", text: "text-color-surface" },
  },
} as const;

export type KumoDialogSize = keyof typeof KUMO_DIALOG_VARIANTS.size;
export type KumoDialogRole = keyof typeof KUMO_DIALOG_VARIANTS.role;

export interface KumoDialogVariantsProps {
  /** @default "base" */
  size?: KumoDialogSize;
}

const DialogRoleContext = createContext<KumoDialogRole>(
  KUMO_DIALOG_DEFAULT_VARIANTS.role,
);

function useDialogRole() {
  return useContext(DialogRoleContext);
}

export function dialogVariants({
  size = KUMO_DIALOG_DEFAULT_VARIANTS.size,
}: KumoDialogVariantsProps = {}) {
  return cn(
    "shadow-m fixed top-1/2 left-1/2 w-full max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-kumo-base text-kumo-default ring ring-kumo-line duration-150 data-ending-style:scale-90 data-ending-style:opacity-0 data-starting-style:scale-90 data-starting-style:opacity-0",
    resolveVariant(
      KUMO_DIALOG_VARIANTS.size,
      size,
      KUMO_DIALOG_DEFAULT_VARIANTS.size,
    ).classes,
  );
}

export type DialogProps = KumoDialogVariantsProps & {
  class?: string;
  className?: string;
  children: JSX.Element;
  style?: JSX.CSSProperties;
  /** Portal container, overriding KumoPortalProvider context. */
  container?: PortalContainer;
};

function DialogContent(props: DialogProps) {
  const role = useDialogRole();
  const contextContainer = usePortalContainerAccessor();
  const container = () => props.container ?? contextContainer() ?? undefined;
  const popupClass = () =>
    cn(
      dialogVariants({
        size: props.size ?? KUMO_DIALOG_DEFAULT_VARIANTS.size,
      }),
      props.class,
      props.className,
    );
  const popupStyle = () =>
    ({
      "transition-property": "scale, opacity",
      "transition-timing-function": "var(--default-transition-timing-function)",
      "--tw-shadow":
        "0 20px 25px -5px rgb(0 0 0 / 0.03), 0 8px 10px -6px rgb(0 0 0 / 0.03)",
      ...props.style,
    }) as JSX.CSSProperties;

  return (
    <Show
      when={role === "alertdialog"}
      fallback={
        <DialogBase.Portal container={container()}>
          <DialogBase.Backdrop class="fixed inset-0 bg-kumo-recessed opacity-80 transition-all duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <LayerCard
            render={(popupProps) => (
              <DialogBase.Popup
                {...popupProps}
                data-kumo-component="Dialog"
                data-kumo-part="content"
              />
            )}
            class={popupClass()}
            style={popupStyle()}
          >
            {props.children}
          </LayerCard>
        </DialogBase.Portal>
      }
    >
      <AlertDialogBase.Portal container={container()}>
        <AlertDialogBase.Backdrop class="fixed inset-0 bg-kumo-recessed opacity-80 transition-all duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <LayerCard
          render={(popupProps) => (
            <AlertDialogBase.Popup
              {...popupProps}
              data-kumo-component="Dialog"
              data-kumo-part="content"
            />
          )}
          class={popupClass()}
          style={popupStyle()}
        >
          {props.children}
        </LayerCard>
      </AlertDialogBase.Portal>
    </Show>
  );
}

type BaseDialogRootProps = ComponentProps<typeof DialogBase.Root>;

export interface DialogRootProps extends Omit<
  BaseDialogRootProps,
  "children" | "dismissible"
> {
  children?: JSX.Element;
  /**
   * The ARIA role and dismissal behavior.
   * @default "dialog"
   */
  role?: KumoDialogRole;
  /**
   * Prevent closing on outside pointer presses.
   * React Kumo compatibility alias for `dismissible={false}`.
   */
  disablePointerDismissal?: boolean;
  /** Solid primitive alias controlling outside-press dismissal. */
  dismissible?: boolean;
}

function DialogRoot(inputProps: DialogRootProps) {
  const [props, rootProps] = splitProps(inputProps, [
    "children",
    "role",
    "disablePointerDismissal",
    "dismissible",
    "modal",
  ]);
  const role = () => props.role ?? KUMO_DIALOG_DEFAULT_VARIANTS.role;

  return (
    <Show
      when={role() === "alertdialog"}
      fallback={
        <DialogRoleContext.Provider value="dialog">
          <DialogBase.Root
            {...rootProps}
            modal={props.modal}
            dismissible={props.dismissible ?? !props.disablePointerDismissal}
          >
            {props.children}
          </DialogBase.Root>
        </DialogRoleContext.Provider>
      }
    >
      <DialogRoleContext.Provider value="alertdialog">
        <AlertDialogBase.Root {...rootProps}>
          {props.children}
        </AlertDialogBase.Root>
      </DialogRoleContext.Provider>
    </Show>
  );
}

type BaseDialogTriggerProps = ComponentProps<typeof DialogBase.Trigger>;

export interface DialogTriggerProps extends Omit<
  BaseDialogTriggerProps,
  "children" | "class" | "render"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
  render?: BaseDialogTriggerProps["render"];
}

function DialogTrigger(inputProps: DialogTriggerProps) {
  const [props, triggerProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "render",
    "nativeButton",
  ]);
  const role = useDialogRole();
  const nativeButton = () =>
    props.nativeButton ??
    (props.render === undefined ||
      props.render === null ||
      props.render === "button");

  return (
    <Show
      when={role === "alertdialog"}
      fallback={
        <DialogBase.Trigger
          {...triggerProps}
          data-kumo-component="Dialog"
          data-kumo-part="trigger"
          class={cn(props.class, props.className)}
          render={props.render}
          nativeButton={nativeButton()}
        >
          {props.children}
        </DialogBase.Trigger>
      }
    >
      <AlertDialogBase.Trigger
        {...triggerProps}
        data-kumo-component="Dialog"
        data-kumo-part="trigger"
        class={cn(props.class, props.className)}
        render={props.render}
        nativeButton={nativeButton()}
      >
        {props.children}
      </AlertDialogBase.Trigger>
    </Show>
  );
}

type BaseDialogTitleProps = ComponentProps<typeof DialogBase.Title>;

export interface DialogTitleProps extends Omit<
  BaseDialogTitleProps,
  "children" | "class"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
}

function DialogTitle(inputProps: DialogTitleProps) {
  const [props, titleProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
  ]);
  const role = useDialogRole();
  const className = () => cn(props.class, props.className);

  return (
    <Show
      when={role === "alertdialog"}
      fallback={
        <DialogBase.Title {...titleProps} class={className()}>
          {props.children}
        </DialogBase.Title>
      }
    >
      <AlertDialogBase.Title {...titleProps} class={className()}>
        {props.children}
      </AlertDialogBase.Title>
    </Show>
  );
}

type BaseDialogDescriptionProps = ComponentProps<typeof DialogBase.Description>;

export interface DialogDescriptionProps extends Omit<
  BaseDialogDescriptionProps,
  "children" | "class"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
}

function DialogDescription(inputProps: DialogDescriptionProps) {
  const [props, descriptionProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
  ]);
  const role = useDialogRole();
  const className = () => cn(props.class, props.className);

  return (
    <Show
      when={role === "alertdialog"}
      fallback={
        <DialogBase.Description {...descriptionProps} class={className()}>
          {props.children}
        </DialogBase.Description>
      }
    >
      <AlertDialogBase.Description {...descriptionProps} class={className()}>
        {props.children}
      </AlertDialogBase.Description>
    </Show>
  );
}

type BaseDialogCloseProps = ComponentProps<typeof DialogBase.Close>;

export interface DialogCloseProps extends Omit<
  BaseDialogCloseProps,
  "children" | "class" | "render"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
  render?: BaseDialogCloseProps["render"];
}

function DialogClose(inputProps: DialogCloseProps) {
  const [props, closeProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "render",
    "nativeButton",
    "type",
  ]);
  const role = useDialogRole();
  const nativeButton = () =>
    props.nativeButton ??
    (props.render === undefined ||
      props.render === null ||
      props.render === "button");

  return (
    <Show
      when={role === "alertdialog"}
      fallback={
        <DialogBase.Close
          {...closeProps}
          data-kumo-component="Dialog"
          data-kumo-part="close"
          class={cn(props.class, props.className)}
          render={props.render}
          nativeButton={nativeButton()}
          type={props.type ?? "button"}
        >
          {props.children}
        </DialogBase.Close>
      }
    >
      <AlertDialogBase.Close
        {...closeProps}
        data-kumo-component="Dialog"
        data-kumo-part="close"
        class={cn(props.class, props.className)}
        render={props.render}
        nativeButton={nativeButton()}
        type={props.type ?? "button"}
      >
        {props.children}
      </AlertDialogBase.Close>
    </Show>
  );
}

type DialogComponent = typeof DialogContent & {
  Root: typeof DialogRoot;
  Trigger: typeof DialogTrigger;
  Title: typeof DialogTitle;
  Description: typeof DialogDescription;
  Close: typeof DialogClose;
};

export const Dialog = Object.assign(DialogContent, {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
}) as DialogComponent;

export {
  DialogRoot,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
