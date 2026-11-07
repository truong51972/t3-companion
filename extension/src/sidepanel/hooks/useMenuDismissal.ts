import { useEffect } from 'react';

/**
 * Handles closing any open `<details>` menu when clicking outside or pressing Escape.
 */
export function useMenuDismissal() {
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const openMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[open]'));
      if (openMenus.length === 0) return;
      const path = event.composedPath();
      for (const menu of openMenus) {
        if (!path.includes(menu)) menu.open = false;
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const openMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[open]'));
      for (const menu of openMenus) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
        event.preventDefault();
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
}
