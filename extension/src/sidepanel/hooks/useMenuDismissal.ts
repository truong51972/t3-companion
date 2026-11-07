import { useEffect } from 'react';

/**
 * Only transient action menus auto-dismiss. Content disclosures such as Runner,
 * Agent Skill, Browser Data, Queue Advanced Options and Manual Setup must stay
 * open until the user explicitly toggles them.
 */
export const DISMISSABLE_MENU_SELECTOR =
  'details.connection-settings[open], details.service-more[open], details.task-more[open]';

export function useMenuDismissal() {
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const openMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>(DISMISSABLE_MENU_SELECTOR));
      if (openMenus.length === 0) return;
      const path = event.composedPath();
      for (const menu of openMenus) {
        if (!path.includes(menu)) menu.open = false;
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const openMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>(DISMISSABLE_MENU_SELECTOR));
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
