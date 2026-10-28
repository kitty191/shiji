import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const storageKey = 'shiji:buyer-history-positions';
interface Position {
  key: string;
  path: string;
  y: number;
}
function readPositions(): Map<string, Position> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored))
      return new Map(
        stored
          .filter(
            (entry): entry is Position =>
              entry &&
              typeof entry.key === 'string' &&
              typeof entry.path === 'string' &&
              typeof entry.y === 'number' &&
              Number.isFinite(entry.y) &&
              entry.y >= 0,
          )
          .slice(-50)
          .map((entry) => [entry.key, entry]),
      );
  } catch {
    /* Position persistence is optional. */
  }
  return new Map();
}
const positions = readPositions();
export function rememberBuyerPosition(path: string, key: string): void {
  positions.delete(key);
  positions.set(key, { key, path, y: window.scrollY });
  while (positions.size > 50) positions.delete(positions.keys().next().value!);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...positions.values()]));
  } catch {
    /* Keep the in-memory fallback. */
  }
}

// Re-arm for each history entry, and wait for that query's actual response.
// Router restoration alone can run while a shorter page or skeleton is visible.
export function useBuyerPosition(ready: boolean): void {
  const location = useLocation(),
    navigation = useNavigationType();
  const restoreCatalog = location.state?.restoreCatalog === true;
  const pending = useRef<{ key: string; y?: number; restored: boolean } | null>(null);
  useLayoutEffect(() => {
    const path = `${location.pathname}${location.search}`;
    if (pending.current?.key !== location.key) {
      const saved =
        navigation === 'POP'
          ? positions.get(location.key)
          : restoreCatalog
            ? [...positions.values()].toReversed().find((entry) => entry.path === path)
            : undefined;
      pending.current = {
        key: location.key,
        y: saved?.path === path ? saved.y : undefined,
        restored: false,
      };
    }
    if (!ready) return;
    if (!pending.current.restored) {
      pending.current.restored = true;
      if (pending.current.y !== undefined)
        window.scrollTo({ top: pending.current.y, behavior: 'instant' });
    }
    // Ignore scroll events caused by the next route shrinking the document
    // before this listener's cleanup has completed.
    const remember = () => {
      if (window.location.hash.slice(1) === path) rememberBuyerPosition(path, location.key);
    };
    remember();
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [ready, location.key, location.pathname, location.search, navigation, restoreCatalog]);
}
