/**
 * Loading state of the pricing the editor opens (from `#pricing=`, a query
 * parameter or the template).
 *
 * Opening a large pricing blocks the page for seconds: Monaco takes the text,
 * the preview parses it and renders it, and the linter goes through it. The
 * editor shows "Loading pricing…" over the editor and the preview until all of
 * that has happened once, so the page does not look frozen.
 */

/** The indicator fades in only after this delay, so a fast load does not flicker. */
export const LOADING_INDICATOR_DELAY_MS = 300;

/**
 * How long, once the pricing is parsed and linted, to keep waiting for Monaco to
 * show it. Monaco is fetched from a CDN; if it never loads, its own placeholder
 * is what the user should see, not an endless overlay.
 */
export const EDITOR_WAIT_MS = 10_000;

export interface PricingLoad {
  /** The YAML has been handed to the editor (it may still be on its way to Monaco). */
  shown: boolean;
  /** The first parse of that YAML for the preview has finished, or failed. */
  parsed: boolean;
}

/** A load that has just started: nothing known yet. */
export const PRICING_LOAD_STARTED: PricingLoad = { shown: false, parsed: false };

export interface EditorView {
  /** What the editor holds. */
  editorValue: string;
  /** The text the linter's current result belongs to (`null` before its first run). */
  lintedValue: string | null;
  /** What Monaco shows, or `null` while it is not mounted. */
  codeEditorValue: string | null;
  /** The visual editor is open instead of Monaco, so Monaco is not waited for. */
  visual: boolean;
}

export type PricingLoadStatus =
  /** Still opening: the indicator stays. */
  | 'loading'
  /** Parsed and linted, only Monaco is missing: wait for it, at most `EDITOR_WAIT_MS`. */
  | 'waiting-for-editor'
  /** Nothing left to wait for. */
  | 'done';

export function pricingLoadStatus(load: PricingLoad | null, view: EditorView): PricingLoadStatus {
  if (load === null) {
    return 'done';
  }

  if (!load.shown || !load.parsed || view.lintedValue !== view.editorValue) {
    return 'loading';
  }

  if (view.visual || view.codeEditorValue === view.editorValue) {
    return 'done';
  }

  return 'waiting-for-editor';
}

/** The load once its YAML is in the editor. */
export function markShown(load: PricingLoad | null): PricingLoad | null {
  return load && { ...load, shown: true };
}

/**
 * The load once its first parse has finished, or failed. A load that failed
 * before it had any YAML to show is over.
 */
export function markParsed(load: PricingLoad | null): PricingLoad | null {
  if (load === null || !load.shown) {
    return null;
  }

  return { ...load, parsed: true };
}

/**
 * Resolves after the browser has painted the current state, so that whatever
 * was just rendered (the loading indicator, the YAML in Monaco) is on screen
 * before the next long task blocks the main thread. `requestAnimationFrame`
 * runs right before a paint, and the timeout lands right after it.
 */
export function afterNextPaint(
  requestFrame: (callback: () => void) => unknown = callback => requestAnimationFrame(callback),
  schedule: (callback: () => void) => unknown = callback => setTimeout(callback, 0)
): Promise<void> {
  return new Promise(resolve => {
    requestFrame(() => {
      schedule(resolve);
    });
  });
}
