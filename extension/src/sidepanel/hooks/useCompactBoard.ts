import { useEffect, useState } from 'react';

// Compact when either the panel is narrow or a tiled window is short.
// Keep this exact media query in sync with the CSS rules in sidepanel.css.
export const COMPACT_BOARD_QUERY =
  '(max-width: 799px), (min-width: 800px) and (max-width: 1199px) and (max-height: 580px)';

export function useCompactBoard(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_BOARD_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_BOARD_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}
