/**
 * Motion constants for framer-motion, mirroring the CSS motion tokens in
 * `src/index.css` (`--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-out`).
 *
 * CSS variables can't be read by framer's JS-driven transforms, so these are
 * the JS-side counterparts. Keep the two in sync — if you change a duration
 * here, change the matching token there.
 *
 * Durations are in seconds (framer's unit), the CSS tokens are in milliseconds.
 */

/** 150ms — hovers, small pops, popover in/out. Mirrors `--dur-fast`. */
export const DUR_FAST = 0.15
/** 200ms — the default for most transitions. Mirrors `--dur-base`. */
export const DUR_BASE = 0.2
/** 300ms — larger surfaces entering or leaving. Mirrors `--dur-slow`. */
export const DUR_SLOW = 0.3

/** Mirrors `--ease-out`. */
export const EASE_OUT = [0.33, 1, 0.68, 1] as const

/**
 * Slight overshoot for elements that pop into existence (the today button, the
 * mobile project menu). Deliberately not a CSS token — it only exists for
 * scale-in entrances, which are all framer-driven.
 */
export const EASE_POP = [0.34, 1.2, 0.64, 1] as const
