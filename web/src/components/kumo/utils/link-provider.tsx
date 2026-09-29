import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type JSX,
} from "solid-js";

export type LinkComponentProps = Omit<
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  href?: string;
  /**
   * @deprecated Use `href`. Custom routing adapters may map `href` to their
   * navigation prop.
   */
  to?: string;
};

export type LinkComponent = Component<LinkComponentProps>;

function DefaultLinkComponent(inputProps: LinkComponentProps) {
  const [props, rest] = splitProps(inputProps, ["href", "to"]);
  return <a href={props.href ?? props.to ?? undefined} {...rest} />;
}

const LinkComponentContext = createContext<LinkComponent>(DefaultLinkComponent);

export function useLinkComponent() {
  return useContext(LinkComponentContext);
}

export interface LinkProviderProps {
  component?: LinkComponent;
  children: JSX.Element;
}

export function LinkProvider(props: LinkProviderProps) {
  return (
    <LinkComponentContext.Provider
      value={props.component ?? DefaultLinkComponent}
    >
      {props.children}
    </LinkComponentContext.Provider>
  );
}
