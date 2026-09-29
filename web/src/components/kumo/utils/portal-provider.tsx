import { createContext, useContext, type Accessor, type JSX } from "solid-js";

/**
 * Solid equivalent of the portal target accepted by Kumo overlays.
 *
 * Pass a signal value to `container` when the target is created after mount;
 * Solid keeps the provider prop reactive for descendants.
 */
export type PortalContainer = HTMLElement | ShadowRoot | null | undefined;

const PortalContainerContext = createContext<Accessor<PortalContainer>>(
  () => null,
);

export interface KumoPortalProviderProps {
  container: PortalContainer;
  children: JSX.Element;
}

export function KumoPortalProvider(props: KumoPortalProviderProps) {
  const container = () => props.container;

  return (
    <PortalContainerContext.Provider value={container}>
      {props.children}
    </PortalContainerContext.Provider>
  );
}

/** Returns the current default target for Kumo overlay portals. */
export function usePortalContainer(): PortalContainer {
  return useContext(PortalContainerContext)();
}

/** @internal Keeps the context value reactive inside overlay components. */
export function usePortalContainerAccessor(): Accessor<PortalContainer> {
  return useContext(PortalContainerContext);
}
