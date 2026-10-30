/**
 * A clickable table row: its button (ROW_BUTTON) is stretched over the whole
 * row by its `::after`, so a click anywhere on the row presses it and the row
 * keeps its table semantics (a `role="button"` row loses its cells). The ring
 * is drawn on that `::after`, inset so the table's scroll box cannot clip it.
 */
export const ROW =
  'relative bg-(--cui-color-background-panel) transition-colors hover:bg-(--cui-color-background-hover) has-[.row-link:focus-visible]:bg-(--cui-color-background-hover)';

export const ROW_BUTTON =
  "row-link cursor-pointer border-none bg-transparent p-0 text-start after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--cui-color-outline)";
