import { useRef, useState, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** How far a row of choices reaches: from its first button's left edge to its last one's right edge. */
function extentOf(container: HTMLElement): number | null {
  const buttons = container.querySelectorAll<HTMLElement>('[role="group"] button');
  if (buttons.length === 0) return null;
  const first = buttons[0].getBoundingClientRect();
  const last = buttons[buttons.length - 1].getBoundingClientRect();
  return last.right - first.left;
}

/**
 * Whether a one-line row of choices (a button group) fits the container the
 * returned ref is put on. While the group shows, its width is measured; once
 * it doesn't fit, `fits` turns false so a compact control (a select) can take
 * its place, and true again when the container is wide enough. `key` names
 * the choices (their labels): new ones are measured afresh.
 */
export function useInlineFit<T extends HTMLElement>(
  key: string,
): { containerRef: RefObject<T | null>; fits: boolean } {
  const containerRef = useRef<T>(null);
  const neededRef = useRef<{ key: string; width: number } | null>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const available = container.clientWidth;
      if (available === 0) return;
      const extent = extentOf(container);
      if (extent != null) {
        const known = neededRef.current?.key === key ? neededRef.current.width : 0;
        neededRef.current = { key, width: Math.max(extent, known) };
      }
      const needed = neededRef.current?.key === key ? neededRef.current.width : 0;
      setFits(Math.ceil(needed) <= available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [key, fits]);

  return { containerRef, fits };
}
