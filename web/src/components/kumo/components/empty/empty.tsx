import { createSignal, onCleanup, type JSX } from "solid-js";
import { CheckRegularIcon, CopyIcon } from "../../internal/icons";
import { cn } from "../../utils/cn";
import { resolveVariant } from "../../utils/resolve-variant";
import { Button } from "../button";

export const KUMO_EMPTY_VARIANTS = {
  size: {
    sm: {
      classes: "px-6 py-8 gap-4",
      description: "Compact empty state for smaller containers",
    },
    base: {
      classes: "px-10 py-16 gap-6",
      description: "Default empty state size",
    },
    lg: {
      classes: "px-12 py-20 gap-8",
      description: "Large empty state for prominent placement",
    },
  },
} as const;

export const KUMO_EMPTY_DEFAULT_VARIANTS = {
  size: "base",
} as const;

export type KumoEmptySize = keyof typeof KUMO_EMPTY_VARIANTS.size;

export interface KumoEmptyVariantsProps {
  size?: KumoEmptySize;
}

export function emptyVariants({
  size = KUMO_EMPTY_DEFAULT_VARIANTS.size,
}: KumoEmptyVariantsProps = {}) {
  return cn(
    "flex w-full flex-col items-center rounded-xl border border-kumo-fill bg-kumo-control text-kumo-default",
    resolveVariant(
      KUMO_EMPTY_VARIANTS.size,
      size,
      KUMO_EMPTY_DEFAULT_VARIANTS.size,
    ).classes,
  );
}

export interface EmptyProps extends KumoEmptyVariantsProps {
  icon?: JSX.Element;
  title: string;
  description?: string;
  commandLine?: string;
  contents?: JSX.Element;
  className?: string;
}

export function Empty(props: EmptyProps) {
  const [emptyStateCopied, setEmptyStateCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const size = () => props.size ?? KUMO_EMPTY_DEFAULT_VARIANTS.size;

  onCleanup(() => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
  });

  const copyCommand = async () => {
    const commandLine = props.commandLine;
    if (!commandLine) return;

    setEmptyStateCopied(true);
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      setEmptyStateCopied(false);
    }, 1000);
    await navigator.clipboard.writeText(commandLine);
  };

  return (
    <div class={cn(emptyVariants({ size: size() }), props.className)}>
      {props.icon}
      <h2 class="text-2xl font-semibold">{props.title}</h2>

      {props.description && (
        <p class="max-w-140 text-center text-kumo-subtle">
          {props.description}
        </p>
      )}

      {props.commandLine && (
        <div
          class={cn(
            "group/cmd relative inline-flex h-10 max-w-8/10 transform-gpu items-center gap-2 rounded-lg font-mono shadow-sm",
            "bg-kumo-overlay pr-2 pl-3",
            "transition-all duration-300 hover:border-kumo-interact/80 hover:shadow-md",
            "border border-kumo-fill/60",
          )}
        >
          <span class="text-xs text-kumo-inactive select-none">$</span>
          <span class="no-scrollbar overflow-scroll text-base whitespace-nowrap text-kumo-brand">
            {props.commandLine}
          </span>
          <Button
            className="group"
            size="sm"
            variant="ghost"
            shape="square"
            aria-label="Copy command"
            onClick={copyCommand}
          >
            {emptyStateCopied() ? (
              <CheckRegularIcon
                size={16}
                class="animate-bounce-in text-kumo-success"
              />
            ) : (
              <CopyIcon
                size={16}
                class="text-kumo-inactive group-hover:text-kumo-brand"
              />
            )}
          </Button>
        </div>
      )}

      {props.contents}
    </div>
  );
}
