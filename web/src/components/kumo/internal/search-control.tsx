import { mergeProps as mergeBaseUIProps } from "@photon-ai/base-ui-solid/merge-props";
import { useRender } from "@photon-ai/base-ui-solid/use-render";
import {
  For,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Accessor,
  type JSX,
  type Ref,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { PortalContainer } from "../utils/portal-provider";

export interface SearchFilter {
  contains<Item>(
    item: Item,
    query: string,
    itemToString?: (item: Item) => string,
  ): boolean;
  startsWith<Item>(
    item: Item,
    query: string,
    itemToString?: (item: Item) => string,
  ): boolean;
  endsWith<Item>(
    item: Item,
    query: string,
    itemToString?: (item: Item) => string,
  ): boolean;
}

export interface SearchFilterOptions extends Intl.CollatorOptions {
  locale?: Intl.LocalesArgument;
}

function defaultItemToString(item: unknown): string {
  if (item == null) return "";
  if (
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "bigint" ||
    typeof item === "boolean"
  ) {
    return String(item);
  }
  if (typeof item === "object") {
    const record = item as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.value === "string") return record.value;
  }
  return "";
}

export function createSearchFilter(
  options: SearchFilterOptions = {},
): SearchFilter {
  const { locale, ...collatorOptions } = options;
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    usage: "search",
    ...collatorOptions,
  });
  const normalize = (value: string) => value.normalize("NFC");
  const includes = (
    item: string,
    query: string,
    position: "any" | "start" | "end",
  ) => {
    const source = Array.from(normalize(item));
    const target = Array.from(normalize(query));
    if (target.length === 0) return true;
    if (target.length > source.length) return false;

    const starts =
      position === "start"
        ? [0]
        : position === "end"
          ? [source.length - target.length]
          : Array.from(
              { length: source.length - target.length + 1 },
              (_, index) => index,
            );

    return starts.some((start) =>
      target.every(
        (character, index) =>
          collator.compare(source[start + index] ?? "", character) === 0,
      ),
    );
  };

  return {
    contains: (item, query, itemToString = defaultItemToString) =>
      includes(itemToString(item), query, "any"),
    startsWith: (item, query, itemToString = defaultItemToString) =>
      includes(itemToString(item), query, "start"),
    endsWith: (item, query, itemToString = defaultItemToString) =>
      includes(itemToString(item), query, "end"),
  };
}

export interface SearchChangeDetails {
  reason: string;
  event: Event;
}

export interface SearchHighlightDetails {
  reason: string;
  event: Event;
  index: number;
}

export type SearchInputValue =
  | string
  | number
  | readonly string[]
  | null
  | undefined;

export interface SearchRootProps<Item> {
  children?: JSX.Element;
  items?: readonly Item[];
  inputValue?: SearchInputValue;
  defaultInputValue?: SearchInputValue;
  onInputValueChange?: (value: string, details: SearchChangeDetails) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: SearchChangeDetails) => void;
  onItemHighlighted?: (
    item: Item | undefined,
    details: SearchHighlightDetails,
  ) => void;
  itemToStringValue?: (item: Item) => string;
  filter?: (item: Item, query: string) => boolean;
  mode?: "list" | "both" | "inline" | "none";
  autoHighlight?: boolean | "always";
  keepHighlight?: boolean;
  highlightItemOnHover?: boolean;
  openOnInputClick?: boolean;
  disabled?: boolean;
  required?: boolean;
  accessibleLabel?: string;
  selectionMode?: "none" | "single" | "multiple";
  selectedValue?: Item | Item[] | null;
  defaultSelectedValue?: Item | Item[] | null;
  onSelectedValueChange?: (
    value: Item | Item[] | null,
    details: SearchChangeDetails,
  ) => void;
  isItemEqualToValue?: (item: Item, value: Item) => boolean;
  closeOnSelect?: boolean;
  fillInputOnSelect?: boolean;
}

interface RegisteredSearchOption {
  id: string;
  value: Accessor<unknown>;
  disabled: Accessor<boolean>;
  element: Accessor<HTMLElement | undefined>;
}

interface SearchControlContextValue {
  inputId: string;
  listboxId: string;
  inputValue: Accessor<string>;
  open: Accessor<boolean>;
  disabled: Accessor<boolean>;
  required: Accessor<boolean>;
  accessibleLabel: Accessor<string | undefined>;
  openOnInputClick: Accessor<boolean>;
  multiple: Accessor<boolean>;
  selectedValue: Accessor<unknown>;
  highlightedId: Accessor<string | undefined>;
  filteredItems: Accessor<readonly unknown[]>;
  filterItems: (items: readonly unknown[]) => readonly unknown[];
  hasMatches: Accessor<boolean>;
  itemToString: (item: unknown) => string;
  isSelected: (item: unknown) => boolean;
  setAnchor: (element: HTMLElement | undefined) => void;
  setPopup: (element: HTMLElement | undefined) => void;
  anchor: Accessor<HTMLElement | undefined>;
  popup: Accessor<HTMLElement | undefined>;
  setInputValue: (value: string, event: Event, reason?: string) => void;
  syncInputValue: (value: string) => void;
  setOpen: (open: boolean, event: Event, reason?: string) => void;
  clear: (event: Event) => void;
  removeValue: (value: unknown, event: Event) => void;
  registerOption: (option: RegisteredSearchOption) => () => void;
  highlightOption: (
    option: RegisteredSearchOption | undefined,
    reason: string,
    event: Event,
  ) => void;
  handleInputKeyDown: (
    event: KeyboardEvent & { currentTarget: HTMLInputElement },
  ) => void;
  selectOption: (option: RegisteredSearchOption, event: Event) => void;
}

const SearchControlContext = createContext<SearchControlContextValue>();
const SearchCollectionContext = createContext<Accessor<readonly unknown[]>>();
const SearchChipValueContext = createContext<Accessor<unknown>>();

export function useSearchControl() {
  const context = useContext(SearchControlContext);
  if (!context) {
    throw new Error(
      "Search control subcomponents must be used inside a search root.",
    );
  }
  return context;
}

function normalizedInputValue(value: SearchInputValue): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

function emptyEvent(reason: string): Event {
  return new Event(reason);
}

function hasNestedItems(
  value: unknown,
): value is { items: readonly unknown[] } {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as { items?: unknown }).items),
  );
}

function valuesEqual(
  item: unknown,
  value: unknown,
  comparator?: (item: never, value: never) => boolean,
) {
  if (Object.is(item, value)) return true;
  if (item == null || value == null) return false;
  return comparator?.(item as never, value as never) ?? false;
}

function setSolidRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    (ref as (value: T) => void)(value);
    return;
  }
  if (ref && typeof ref === "object" && "current" in ref) {
    (ref as { current: T }).current = value;
  }
}

function orderedOptions(
  options: RegisteredSearchOption[],
): RegisteredSearchOption[] {
  return [...options].sort((first, second) => {
    const firstElement = first.element();
    const secondElement = second.element();
    if (!firstElement || !secondElement || firstElement === secondElement) {
      return 0;
    }
    const position = firstElement.compareDocumentPosition(secondElement);
    if (position & 4) return -1;
    if (position & 2) return 1;
    return 0;
  });
}

export function SearchRoot<Item>(props: SearchRootProps<Item>) {
  const inputControlled = () => props.inputValue !== undefined;
  const openControlled = () => props.open !== undefined;
  const selectionControlled = () => props.selectedValue !== undefined;
  const selectionMode = () => props.selectionMode ?? "none";
  const multiple = () => selectionMode() === "multiple";
  const [uncontrolledInputValue, setUncontrolledInputValue] = createSignal(
    normalizedInputValue(props.defaultInputValue),
  );
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    props.defaultOpen ?? false,
  );
  const [uncontrolledSelectedValue, setUncontrolledSelectedValue] =
    createSignal<unknown>(
      props.defaultSelectedValue ?? (multiple() ? [] : null),
    );
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [popup, setPopup] = createSignal<HTMLElement>();
  const [options, setOptions] = createSignal<RegisteredSearchOption[]>([]);
  const [highlightedId, setHighlightedId] = createSignal<string>();
  const [pendingKeyboardHighlight, setPendingKeyboardHighlight] = createSignal<
    "first" | "last"
  >();
  const inputId = createUniqueId();
  const listboxId = createUniqueId();
  const defaultFilter = createSearchFilter();

  const inputValue = () =>
    inputControlled()
      ? normalizedInputValue(props.inputValue)
      : uncontrolledInputValue();
  const open = () =>
    openControlled() ? Boolean(props.open) : uncontrolledOpen();
  const selectedValue = () =>
    selectionControlled() ? props.selectedValue : uncontrolledSelectedValue();
  const itemToString = (item: unknown) =>
    props.itemToStringValue?.(item as Item) ?? defaultItemToString(item);
  const matches = (item: unknown, query: string) =>
    props.mode === "none" || props.mode === "inline"
      ? true
      : (props.filter?.(item as Item, query) ??
        defaultFilter.contains(item, query, itemToString));
  const filterItems = (source: readonly unknown[]): readonly unknown[] => {
    const rawQuery = inputValue().trim();
    const currentSelection = selectedValue();
    const query =
      selectionMode() === "single" &&
      currentSelection != null &&
      rawQuery === itemToString(currentSelection)
        ? ""
        : rawQuery;
    if (!query) return source;
    return source.filter((item) => {
      if (hasNestedItems(item)) {
        return filterItems(item.items).length > 0;
      }
      return matches(item, query);
    });
  };
  const filteredItems = createMemo(() => filterItems(props.items ?? []));
  const hasMatches = () => filteredItems().length > 0;
  const enabledOptions = () =>
    orderedOptions(options()).filter(
      (option) => !option.disabled() && option.element(),
    );
  const equal = (item: unknown, value: unknown) =>
    valuesEqual(
      item,
      value,
      props.isItemEqualToValue as
        | ((item: never, value: never) => boolean)
        | undefined,
    );
  const isSelected = (item: unknown) => {
    if (selectionMode() === "none") {
      return itemToString(item) === inputValue();
    }
    const selected = selectedValue();
    if (multiple()) {
      return Array.isArray(selected)
        ? selected.some((value) => equal(item, value))
        : false;
    }
    return equal(item, selected);
  };

  const setInputValue = (value: string, event: Event, reason = "input") => {
    if (!inputControlled()) setUncontrolledInputValue(value);
    props.onInputValueChange?.(value, { reason, event });
  };
  const syncInputValue = (value: string) => {
    if (!inputControlled()) setUncontrolledInputValue(value);
  };
  const setOpen = (nextOpen: boolean, event: Event, reason = "none") => {
    if (props.disabled) return;
    if (!openControlled()) setUncontrolledOpen(nextOpen);
    props.onOpenChange?.(nextOpen, { reason, event });
    if (!nextOpen && !props.keepHighlight) {
      setHighlightedId(undefined);
    }
  };
  const setSelected = (value: unknown, event: Event, reason: string) => {
    if (!selectionControlled()) {
      setUncontrolledSelectedValue(() => value);
    }
    props.onSelectedValueChange?.(value as Item | Item[] | null, {
      reason,
      event,
    });
  };
  const clear = (event: Event) => {
    setInputValue("", event, "clear-press");
    if (selectionMode() !== "none") {
      setSelected(multiple() ? [] : null, event, "clear-press");
    }
  };
  const removeValue = (value: unknown, event: Event) => {
    if (!multiple()) return;
    const current = Array.isArray(selectedValue())
      ? (selectedValue() as unknown[])
      : [];
    setSelected(
      current.filter((item) => !equal(item, value)),
      event,
      "chip-remove",
    );
  };
  const highlightOption = (
    option: RegisteredSearchOption | undefined,
    reason: string,
    event: Event,
  ) => {
    if (option?.disabled()) return;
    setHighlightedId(option?.id);
    const index = option
      ? enabledOptions().findIndex((candidate) => candidate.id === option.id)
      : -1;
    props.onItemHighlighted?.(option?.value() as Item | undefined, {
      reason,
      event,
      index,
    });
    option?.element()?.scrollIntoView?.({ block: "nearest" });
  };
  const selectOption = (option: RegisteredSearchOption, event: Event) => {
    if (option.disabled()) return;
    const value = option.value();

    if (multiple()) {
      const current = Array.isArray(selectedValue())
        ? (selectedValue() as unknown[])
        : [];
      const next = isSelected(value)
        ? current.filter((item) => !equal(item, value))
        : [...current, value];
      setSelected(next, event, "item-press");
      setInputValue("", event, "item-press");
      if (props.closeOnSelect) {
        setOpen(false, event, "item-press");
      }
      return;
    }

    if (selectionMode() === "single") {
      setSelected(value, event, "item-press");
    }
    if (props.fillInputOnSelect ?? true) {
      setInputValue(itemToString(value), event, "item-press");
    }
    if (props.closeOnSelect ?? true) {
      setOpen(false, event, "item-press");
    }
  };
  const registerOption = (option: RegisteredSearchOption) => {
    setOptions((current) => [...current, option]);
    return () => {
      setOptions((current) =>
        current.filter((candidate) => candidate !== option),
      );
      if (highlightedId() === option.id) {
        setHighlightedId(undefined);
      }
    };
  };
  const handleInputKeyDown = (
    event: KeyboardEvent & { currentTarget: HTMLInputElement },
  ) => {
    if (event.defaultPrevented || event.isComposing) return;
    const available = enabledOptions();
    const currentIndex = available.findIndex(
      (option) => option.id === highlightedId(),
    );

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open()) {
        setOpen(true, event, "trigger-press");
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (available.length === 0) {
        setPendingKeyboardHighlight(direction === 1 ? "first" : "last");
        return;
      }
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : available.length - 1
          : (currentIndex + direction + available.length) % available.length;
      highlightOption(available[nextIndex], "keyboard", event);
      return;
    }

    if (event.key === "Home" && open()) {
      event.preventDefault();
      highlightOption(available[0], "keyboard", event);
      return;
    }

    if (event.key === "End" && open()) {
      event.preventDefault();
      highlightOption(available[available.length - 1], "keyboard", event);
      return;
    }

    if (event.key === "Enter" && open() && currentIndex >= 0) {
      event.preventDefault();
      available[currentIndex]?.element()?.click();
      return;
    }

    if (event.key === "Escape" && open()) {
      event.preventDefault();
      setOpen(false, event, "escape-key");
      return;
    }

    if (event.key === "Backspace" && multiple() && inputValue() === "") {
      const selected = Array.isArray(selectedValue())
        ? (selectedValue() as unknown[])
        : [];
      const last = selected.at(-1);
      if (last !== undefined) removeValue(last, event);
    }
  };

  createEffect(() => {
    const available = enabledOptions();
    const pending = pendingKeyboardHighlight();
    if (pending && available.length > 0) {
      setPendingKeyboardHighlight(undefined);
      highlightOption(
        pending === "first" ? available[0] : available[available.length - 1],
        "keyboard",
        emptyEvent("keyboard"),
      );
      return;
    }
    const shouldAutoHighlight =
      props.autoHighlight === "always" ||
      (props.autoHighlight === true && inputValue().length > 0);
    if (!shouldAutoHighlight || available.length === 0) return;
    const current = available.find((option) => option.id === highlightedId());
    if (current) return;
    const selectedOption = available.find((option) =>
      isSelected(option.value()),
    );
    highlightOption(
      selectedOption ?? available[0],
      "none",
      emptyEvent("auto-highlight"),
    );
  });

  createEffect(() => {
    if (!open() || typeof document === "undefined") return;
    const ownerDocument =
      anchor()?.ownerDocument ?? popup()?.ownerDocument ?? document;
    const handlePointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        (anchor() && path.includes(anchor()!)) ||
        (popup() && path.includes(popup()!))
      ) {
        return;
      }
      setOpen(false, event, "outside-press");
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    onCleanup(() =>
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true),
    );
  });

  const context: SearchControlContextValue = {
    inputId,
    listboxId,
    inputValue,
    open,
    disabled: () => Boolean(props.disabled),
    required: () => Boolean(props.required),
    accessibleLabel: () => props.accessibleLabel,
    openOnInputClick: () => Boolean(props.openOnInputClick),
    multiple,
    selectedValue,
    highlightedId,
    filteredItems,
    filterItems,
    hasMatches,
    itemToString,
    isSelected,
    setAnchor,
    setPopup,
    anchor,
    popup,
    setInputValue,
    syncInputValue,
    setOpen,
    clear,
    removeValue,
    registerOption,
    highlightOption,
    handleInputKeyDown,
    selectOption,
  };

  return (
    <SearchControlContext.Provider value={context}>
      {props.children}
    </SearchControlContext.Provider>
  );
}

type SearchInputNativeProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  | "children"
  | "class"
  | "className"
  | "defaultValue"
  | "onClick"
  | "onInput"
  | "onKeyDown"
  | "ref"
  | "value"
>;

export interface SearchInputProps extends SearchInputNativeProps {
  /** Whether this input is the popup positioning anchor. @default true */
  anchor?: boolean;
  class?: string;
  className?: string;
  autoComplete?: string;
  ref?: Ref<HTMLInputElement>;
  onClick?: (event: MouseEvent & { currentTarget: HTMLInputElement }) => void;
  onInput?: (event: InputEvent & { currentTarget: HTMLInputElement }) => void;
  onKeyDown?: (
    event: KeyboardEvent & { currentTarget: HTMLInputElement },
  ) => void;
}

export function SearchInput(inputProps: SearchInputProps) {
  const [props, inputElementProps] = splitProps(inputProps, [
    "aria-label",
    "aria-labelledby",
    "anchor",
    "autoComplete",
    "autocomplete",
    "class",
    "className",
    "disabled",
    "onClick",
    "onInput",
    "onKeyDown",
    "ref",
  ]);
  const context = useSearchControl();

  return (
    <input
      {...inputElementProps}
      id={context.inputId}
      ref={(element) => {
        if (props.anchor !== false) context.setAnchor(element);
        setSolidRef(props.ref, element);
      }}
      role="combobox"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-controls={context.open() ? context.listboxId : undefined}
      aria-expanded={context.open()}
      aria-activedescendant={context.highlightedId()}
      aria-label={props["aria-label"] ?? context.accessibleLabel()}
      aria-labelledby={props["aria-labelledby"]}
      autocomplete={props.autoComplete ?? props.autocomplete ?? "off"}
      required={context.required()}
      disabled={props.disabled ?? context.disabled()}
      class={props.class ?? props.className}
      value={context.inputValue()}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && context.openOnInputClick()) {
          context.setOpen(true, event, "input-press");
        }
      }}
      onInput={(event) => {
        props.onInput?.(event);
        if (event.defaultPrevented) return;
        context.setInputValue(event.currentTarget.value, event, "input");
        context.setOpen(true, event, "input");
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        context.handleInputKeyDown(event);
      }}
    />
  );
}

export interface SearchTriggerProps extends Omit<
  useRender.ComponentProps<"button">,
  "children" | "class" | "className" | "render"
> {
  /** Whether this trigger is the popup positioning anchor. @default true */
  anchor?: boolean;
  children?: JSX.Element;
  class?: string;
  className?: string;
  render?: useRender.RenderProp;
}

export function SearchTrigger(inputProps: SearchTriggerProps) {
  const [props, triggerProps] = splitProps(inputProps, [
    "anchor",
    "children",
    "class",
    "className",
    "disabled",
    "onClick",
    "ref",
    "render",
  ]);
  const context = useSearchControl();
  const element = useRender({
    get render() {
      return props.render ?? "button";
    },
    ref: (renderedElement: HTMLElement) => {
      if (props.anchor !== false) context.setAnchor(renderedElement);
      setSolidRef(props.ref as Ref<HTMLElement> | undefined, renderedElement);
    },
    props: mergeBaseUIProps<"button">(
      {
        type: "button",
        role: "combobox",
        get "aria-controls"() {
          return context.open() ? context.listboxId : undefined;
        },
        get "aria-expanded"() {
          return context.open();
        },
        "aria-haspopup": "listbox",
        get "aria-label"() {
          return triggerProps["aria-label"] ?? context.accessibleLabel();
        },
        get disabled() {
          return Boolean(props.disabled ?? context.disabled());
        },
        get class() {
          return props.class ?? props.className;
        },
        onClick(event: MouseEvent) {
          context.setOpen(!context.open(), event, "trigger-press");
        },
      },
      triggerProps,
      props.onClick
        ? {
            onClick: props.onClick,
          }
        : {},
    ),
    get children() {
      return props.children;
    },
  });

  return element();
}

export interface SearchValueProps {
  children?: JSX.Element | ((value: unknown) => JSX.Element);
  placeholder?: JSX.Element;
  class?: string;
  className?: string;
}

export function SearchValue(props: SearchValueProps) {
  const context = useSearchControl();
  const resolvedChildren = createMemo(() => props.children);
  const value = () => context.selectedValue();
  const isEmpty = () => {
    const currentValue = value();
    return context.multiple()
      ? !Array.isArray(currentValue) || currentValue.length === 0
      : currentValue == null;
  };
  const content = () => {
    if (isEmpty()) return props.placeholder;
    const child = resolvedChildren();
    if (typeof child === "function") {
      return (child as (value: unknown) => JSX.Element)(value());
    }
    if (child !== undefined) return child;
    if (Array.isArray(value())) {
      return (value() as unknown[]).map(context.itemToString).join(", ");
    }
    return context.itemToString(value());
  };

  return (
    <span
      data-placeholder={isEmpty() ? "" : undefined}
      class={props.class ?? props.className}
    >
      {content()}
    </span>
  );
}

export interface SearchIconProps extends Omit<
  JSX.HTMLAttributes<HTMLSpanElement>,
  "class"
> {
  class?: string;
  className?: string;
}

export function SearchIcon(props: SearchIconProps) {
  const [local, elementProps] = splitProps(props, [
    "children",
    "class",
    "className",
  ]);
  return (
    <span
      {...elementProps}
      aria-hidden="true"
      class={local.class ?? local.className}
    >
      {local.children}
    </span>
  );
}

export interface SearchClearProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "onClick"
> {
  class?: string;
  className?: string;
  onClick?: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}

export function SearchClear(inputProps: SearchClearProps) {
  const [props, buttonProps] = splitProps(inputProps, [
    "class",
    "className",
    "onClick",
  ]);
  const context = useSearchControl();
  const empty = () => {
    const selected = context.selectedValue();
    return (
      context.inputValue() === "" &&
      (context.multiple()
        ? !Array.isArray(selected) || selected.length === 0
        : selected == null)
    );
  };

  return (
    <button
      {...buttonProps}
      type="button"
      data-disabled={empty() ? "" : undefined}
      aria-disabled={empty()}
      class={props.class ?? props.className}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        if (empty()) {
          context.setOpen(true, event, "trigger-press");
        } else {
          context.clear(event);
        }
      }}
    />
  );
}

export interface SearchListProps<Item = unknown> extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children" | "class"
> {
  children?:
    | JSX.Element
    | ((item: Item, index: Accessor<number>) => JSX.Element);
  class?: string;
  className?: string;
}

export function SearchList<Item = unknown>(inputProps: SearchListProps<Item>) {
  const [props, listProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
  ]);
  const context = useSearchControl();
  const renderItem = () =>
    typeof props.children === "function" ? (
      <For each={context.filteredItems() as readonly Item[]}>
        {(item, index) =>
          (
            props.children as (
              item: Item,
              index: Accessor<number>,
            ) => JSX.Element
          )(item, index)
        }
      </For>
    ) : (
      props.children
    );

  return (
    <div
      {...listProps}
      id={context.listboxId}
      role="listbox"
      aria-multiselectable={context.multiple() ? "true" : undefined}
      class={props.class ?? props.className}
    >
      {renderItem()}
    </div>
  );
}

export interface SearchGroupProps<Item = unknown> extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children" | "class"
> {
  children?: JSX.Element;
  items?: readonly Item[];
  class?: string;
  className?: string;
}

export function SearchGroup<Item = unknown>(
  inputProps: SearchGroupProps<Item>,
) {
  const [props, groupProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "items",
  ]);
  const context = useSearchControl();
  const filteredItems = createMemo(() =>
    context.filterItems(props.items ?? []),
  );

  return (
    <Show when={filteredItems().length > 0}>
      <SearchCollectionContext.Provider value={filteredItems}>
        <div
          {...groupProps}
          role="group"
          class={props.class ?? props.className}
        >
          {props.children}
        </div>
      </SearchCollectionContext.Provider>
    </Show>
  );
}

export interface SearchGroupLabelProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  class?: string;
  className?: string;
}

export function SearchGroupLabel(inputProps: SearchGroupLabelProps) {
  const [props, labelProps] = splitProps(inputProps, ["class", "className"]);
  return (
    <div
      {...labelProps}
      role="presentation"
      class={props.class ?? props.className}
    />
  );
}

export interface SearchCollectionProps<Item = unknown> {
  children:
    | JSX.Element
    | ((item: Item, index: Accessor<number>) => JSX.Element);
}

export function SearchCollection<Item = unknown>(
  props: SearchCollectionProps<Item>,
) {
  const collection = useContext(SearchCollectionContext);
  if (!collection) {
    throw new Error("Search Collection must be used inside a search Group.");
  }

  return (
    <Show
      when={typeof props.children === "function"}
      fallback={props.children as JSX.Element}
    >
      <For each={collection() as readonly Item[]}>
        {(item, index) =>
          (
            props.children as (
              item: Item,
              index: Accessor<number>,
            ) => JSX.Element
          )(item, index)
        }
      </For>
    </Show>
  );
}

export interface SearchItemProps<Item = unknown> extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "children" | "class" | "onClick" | "onPointerMove" | "ref"
> {
  value: Item;
  children?: JSX.Element;
  class?: string;
  className?: string;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
  onClick?: (event: MouseEvent & { currentTarget: HTMLDivElement }) => void;
  onPointerMove?: (
    event: PointerEvent & { currentTarget: HTMLDivElement },
  ) => void;
}

export function SearchItem<Item = unknown>(inputProps: SearchItemProps<Item>) {
  const [props, itemProps] = splitProps(inputProps, [
    "children",
    "class",
    "className",
    "disabled",
    "onClick",
    "onPointerMove",
    "ref",
    "value",
  ]);
  const context = useSearchControl();
  const id = createUniqueId();
  const [element, setElement] = createSignal<HTMLDivElement>();
  const option: RegisteredSearchOption = {
    id,
    value: () => props.value,
    disabled: () => Boolean(props.disabled),
    element,
  };
  const highlighted = () => context.highlightedId() === id;
  const selected = () => context.isSelected(props.value);

  onMount(() => {
    const unregister = context.registerOption(option);
    onCleanup(unregister);
  });

  return (
    <div
      {...itemProps}
      id={id}
      ref={(node) => {
        setElement(node);
        setSolidRef(props.ref, node);
      }}
      role="option"
      tabIndex={-1}
      aria-disabled={props.disabled ? "true" : undefined}
      aria-selected={selected()}
      data-disabled={props.disabled ? "" : undefined}
      data-highlighted={highlighted() ? "" : undefined}
      data-selected={selected() ? "" : undefined}
      class={props.class ?? props.className}
      onPointerDown={(event) => {
        if (!props.disabled) event.preventDefault();
      }}
      onPointerMove={(event) => {
        props.onPointerMove?.(event);
        if (!event.defaultPrevented && !props.disabled) {
          context.highlightOption(option, "pointer", event);
        }
      }}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && !props.disabled) {
          context.selectOption(option, event);
        }
      }}
    >
      {props.children}
    </div>
  );
}

export interface SearchEmptyProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  class?: string;
  className?: string;
}

export function SearchEmpty(inputProps: SearchEmptyProps) {
  const [props, emptyProps] = splitProps(inputProps, ["class", "className"]);
  const context = useSearchControl();
  return (
    <Show when={!context.hasMatches()}>
      <div {...emptyProps} class={props.class ?? props.className} />
    </Show>
  );
}

export interface SearchSeparatorProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  class?: string;
  className?: string;
}

export function SearchSeparator(inputProps: SearchSeparatorProps) {
  const [props, separatorProps] = splitProps(inputProps, [
    "class",
    "className",
  ]);
  return (
    <div
      {...separatorProps}
      role="separator"
      class={props.class ?? props.className}
    />
  );
}

export interface SearchPopupProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class" | "style"
> {
  children?: JSX.Element;
  class?: string;
  className?: string;
  style?: JSX.CSSProperties;
  align?: "start" | "center" | "end";
  alignOffset?: number;
  collisionPadding?: number;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  container?: PortalContainer;
  hideWhenEmpty?: boolean;
}

export function SearchPopup(inputProps: SearchPopupProps) {
  const [props, popupProps] = splitProps(inputProps, [
    "align",
    "alignOffset",
    "children",
    "class",
    "className",
    "collisionPadding",
    "container",
    "hideWhenEmpty",
    "side",
    "sideOffset",
    "style",
  ]);
  const context = useSearchControl();
  const [position, setPosition] = createSignal<JSX.CSSProperties>({
    position: "fixed",
    top: "0px",
    left: "0px",
  });
  let popupElement: HTMLDivElement | undefined;

  const updatePosition = () => {
    const anchor = context.anchor();
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const popupRect = popupElement?.getBoundingClientRect();
    const side = props.side ?? "bottom";
    const align = props.align ?? "start";
    const sideOffset = props.sideOffset ?? 4;
    const alignOffset = props.alignOffset ?? 0;
    const collisionPadding = props.collisionPadding ?? 5;
    let top = rect.bottom + sideOffset;
    let left = rect.left + alignOffset;

    if (side === "top") {
      top = rect.top - (popupRect?.height ?? 0) - sideOffset;
    } else if (side === "left") {
      left = rect.left - (popupRect?.width ?? 0) - sideOffset;
      top = rect.top + alignOffset;
    } else if (side === "right") {
      left = rect.right + sideOffset;
      top = rect.top + alignOffset;
    }

    if (side === "top" || side === "bottom") {
      if (align === "center") {
        left =
          rect.left +
          (rect.width - (popupRect?.width ?? rect.width)) / 2 +
          alignOffset;
      } else if (align === "end") {
        left = rect.right - (popupRect?.width ?? rect.width) + alignOffset;
      }
    } else if (align === "center") {
      top =
        rect.top +
        (rect.height - (popupRect?.height ?? rect.height)) / 2 +
        alignOffset;
    } else if (align === "end") {
      top = rect.bottom - (popupRect?.height ?? rect.height) + alignOffset;
    }

    setPosition({
      position: "fixed",
      top: `${Math.max(collisionPadding, top)}px`,
      left: `${Math.max(collisionPadding, left)}px`,
      "--anchor-width": `${rect.width}px`,
      "--anchor-height": `${rect.height}px`,
      "--available-height": `${Math.max(
        0,
        window.innerHeight - rect.bottom - sideOffset - collisionPadding,
      )}px`,
      "--available-width": `${Math.max(
        0,
        window.innerWidth - collisionPadding * 2,
      )}px`,
    } as JSX.CSSProperties);
  };

  createEffect(() => {
    if (!context.open() || typeof window === "undefined") return;
    queueMicrotask(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    onCleanup(() => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    });
  });

  return (
    <Show
      when={context.open() && (!props.hideWhenEmpty || context.hasMatches())}
    >
      <Portal
        mount={props.container ? (props.container as HTMLElement) : undefined}
      >
        <div
          {...popupProps}
          ref={(element) => {
            popupElement = element;
            context.setPopup(element);
            updatePosition();
          }}
          data-open=""
          class={props.class ?? props.className}
          style={{ ...position(), ...props.style }}
        >
          {props.children}
        </div>
      </Portal>
    </Show>
  );
}

export interface SearchChipsProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  class?: string;
  className?: string;
}

export function SearchChips(inputProps: SearchChipsProps) {
  const [props, chipsProps] = splitProps(inputProps, ["class", "className"]);
  const context = useSearchControl();
  return (
    <div
      {...chipsProps}
      data-disabled={context.disabled() ? "" : undefined}
      class={props.class ?? props.className}
    />
  );
}

export function SearchChipValueProvider(props: {
  value: unknown;
  children: JSX.Element;
}) {
  return (
    <SearchChipValueContext.Provider value={() => props.value}>
      {props.children}
    </SearchChipValueContext.Provider>
  );
}

export interface SearchChipProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  class?: string;
  className?: string;
  value?: unknown;
}

export function SearchChip(inputProps: SearchChipProps) {
  const [props, chipProps] = splitProps(inputProps, [
    "class",
    "className",
    "value",
  ]);
  return <div {...chipProps} class={props.class ?? props.className} />;
}

export interface SearchChipRemoveProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "onClick" | "value"
> {
  class?: string;
  className?: string;
  value?: unknown;
  onClick?: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}

export function SearchChipRemove(inputProps: SearchChipRemoveProps) {
  const [props, buttonProps] = splitProps(inputProps, [
    "class",
    "className",
    "onClick",
    "value",
  ]);
  const context = useSearchControl();
  const contextualValue = useContext(SearchChipValueContext);
  return (
    <button
      {...buttonProps}
      type="button"
      class={props.class ?? props.className}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        event.stopPropagation();
        context.removeValue(props.value ?? contextualValue?.(), event);
      }}
    />
  );
}
