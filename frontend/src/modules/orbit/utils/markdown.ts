/**
 * How ORBIT's answers lay out tables. The chat can be the narrow widget, so a
 * table keeps readable columns and scrolls sideways instead of squeezing every
 * cell into a word per line.
 */
export const ORBIT_MARKDOWN_CLASSES = [
  '[&_table]:my-2 [&_table]:text-[12px] [&_table]:leading-snug',
  '[&_th]:whitespace-nowrap [&_th]:bg-tp-hairline-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:min-w-[7rem] [&_td]:max-w-[16rem] [&_td]:border-t [&_td]:border-tp-hairline [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
  '[&_th:first-child]:pl-2.5 [&_td:first-child]:pl-2.5',
].join(' ');
