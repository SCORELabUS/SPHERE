/** A row of the services tree, highlighted when it is the one picked. */
export const rowButtonClass = (on: boolean) =>
  `flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-tp-primary ${
    on ? 'bg-tp-primary/10 text-tp-primary' : 'text-tp-ink hover:bg-tp-surface'
  }`;
