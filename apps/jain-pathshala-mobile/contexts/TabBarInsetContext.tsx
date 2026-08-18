import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * How much chrome sits at the bottom of the CURRENT screen.
 *
 * The library mini player is mounted once at the root, above every route, with
 * a hardcoded `bottomOffset={64}` — roughly a tab bar's height. On the tabbed
 * home screens that is right. On everything pushed on top of them (a library
 * section, Downloads, a Panchang day) there is no tab bar, so the player floats
 * 64px above the bottom edge with a strip of screen showing beneath it, and it
 * still covers the last row of any list that did not happen to pad for it.
 *
 * A tab layout publishes its height here; anything that does not sets nothing,
 * and the player sits on the bottom edge where it belongs. Deliberately not
 * derived from the route name — a segment-matching rule would be one rename
 * away from being wrong, and wrong silently.
 */
const TabBarInsetContext = createContext<{
  height: number;
  setHeight: (h: number) => void;
}>({ height: 0, setHeight: () => {} });

export function TabBarInsetProvider({ children }: { children: ReactNode }) {
  const [height, setHeightState] = useState(0);
  // Stable identity so a layout can call this from an effect without looping.
  const setHeight = useCallback((h: number) => {
    setHeightState((current) => (current === h ? current : h));
  }, []);
  const value = useMemo(() => ({ height, setHeight }), [height, setHeight]);
  return <TabBarInsetContext.Provider value={value}>{children}</TabBarInsetContext.Provider>;
}

/** Read the current bottom chrome height (0 when there is none). */
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext).height;
}

/** Publish/clear this layout's bottom chrome height. */
export function useSetTabBarInset(): (h: number) => void {
  return useContext(TabBarInsetContext).setHeight;
}
