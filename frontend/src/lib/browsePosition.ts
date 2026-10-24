import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const key = 'shiji:buyer-position';
export function rememberBuyerPosition(path: string): void {
  try { sessionStorage.setItem(key, JSON.stringify({ path, y: window.scrollY })); } catch { /* Optional within-tab convenience. */ }
}

// Router restoration can run before an async catalog has its full height.
export function useBuyerPosition(ready: boolean): void {
  const location = useLocation(), navigation = useNavigationType();
  const restoring = useRef(navigation === 'POP' || location.state?.restoreCatalog === true);
  useLayoutEffect(() => {
    if (!ready || !restoring.current) return;
    restoring.current = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null') as { path: string; y: number } | null;
      if (saved?.path === `${location.pathname}${location.search}` && Number.isFinite(saved.y) && saved.y >= 0) window.scrollTo({ top: saved.y, behavior: 'instant' });
    } catch { /* Missing or invalid stored positions should not interrupt browsing. */ }
  }, [ready, location.pathname, location.search]);
}
