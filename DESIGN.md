---
name: Calino
description: A lightweight, editorial CalDAV calendar for the web
colors:
  terracotta-clay: '#b07d4f'
  terracotta-clay-hover: '#996442'
  terracotta-clay-soft: '#efe7db'
  warm-paper: '#faf8f3'
  paper-white: '#ffffff'
  parchment-side: '#f6f3ed'
  ink-charcoal: '#2c2823'
  ink-muted: '#6f6a62'
  ink-faint: '#a39d93'
  hairline: 'rgba(44, 40, 33, 0.09)'
  moss-success: '#34a853'
  amber-warning: '#fbbc04'
  clay-error: '#ea4335'
  muted-rose-error: '#c47068'
typography:
  display:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: '32px'
    fontWeight: 400
    lineHeight: 1
    letterSpacing: '-0.018em'
  headline:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: '27px'
    fontWeight: 500
    letterSpacing: '-0.01em'
  title:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: '20px'
    fontWeight: 500
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '13px'
    fontWeight: 500
rounded:
  sm: '4px'
  md: '8px'
  lg: '12px'
  xl: '16px'
  full: '9999px'
  event-card: '7px'
spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '20px'
  6: '24px'
  8: '32px'
  10: '40px'
  12: '48px'
  16: '64px'
components:
  button-primary:
    backgroundColor: '{colors.terracotta-clay}'
    textColor: '{colors.warm-paper}'
    rounded: '{rounded.sm}'
    padding: '8px 16px'
  button-primary-hover:
    backgroundColor: '{colors.terracotta-clay-hover}'
  button-secondary:
    backgroundColor: '{colors.hairline}'
    textColor: '{colors.ink-charcoal}'
    rounded: '{rounded.sm}'
    padding: '8px 16px'
  input-field:
    backgroundColor: '{colors.paper-white}'
    textColor: '{colors.ink-charcoal}'
    rounded: '{rounded.sm}'
    padding: '10px 12px'
  modal-card:
    backgroundColor: '{colors.paper-white}'
    rounded: '{rounded.md}'
---

# Design System: Calino

## Overview

**Creative North Star: "The Editorial Desk"**

Calino reads like a calm writing desk, not a productivity dashboard: a warm paper canvas, ink-colored text, and a single terracotta accent that gets used sparingly, the way a margin note or a paperclip stands out on an otherwise quiet page. The system's own code comments describe it as "Editorial Design" with a "warm paper aesthetic," and events carry an "Accent Rail Treatment" — a thin colored bar rather than a filled block — so category color signals without shouting. A serif display face (Newsreader) marks the things that deserve a moment of attention — month names, section headers, journal entries, brand marks — while the rest of the interface (buttons, labels, event bodies, form fields) stays in a plain system sans so density-heavy calendar grids don't turn into a wall of display type.

This is a deliberately unbranded, non-corporate calendar: no gradients, no glassy chrome beyond restrained backdrop blurs on floating controls, no saturated "app blue." The palette instead behaves like aged paper and ink, with color reserved for meaning (event categories, status, the single accent) rather than decoration.

**Key Characteristics:**

- Warm paper canvas + charcoal ink, not white-and-black
- One accent color (terracotta clay), applied narrowly and consistently
- Serif display type (Newsreader) for moments of hierarchy; sans for everything operational
- Flat by default; soft ambient shadows only in light mode, near-flat in dark mode
- Color-coded "accent rail" on events instead of filled color blocks

## Colors

The palette behaves like paper and ink: warm neutrals carry the interface, and a single terracotta accent is the only color allowed to command attention on its own. Category and calendar colors (user-assigned, not part of this token set) are the exception — they're meant to be seen, and the system mixes them gently into card backgrounds rather than using them as solid fills.

### Primary

- **Terracotta Clay** (`#b07d4f` light / `#c9956a` dark): the sole accent. Used for the current-day marker, primary buttons, focus rings, links, active states, and the brand mark. Deliberately restrained — it should never feel like it's competing with a dozen other saturated colors on screen.

### Neutral

- **Warm Paper** (`#faf8f3` light / `#1a1816` dark): the base canvas — never pure white or pure black.
- **Paper White** (`#ffffff` light / `#242220` dark): panels, modals, cards, and other "raised" surfaces sitting on the canvas.
- **Parchment Side** (`#f6f3ed` light / `#2a2826` dark): sidebar and secondary-surface tint, one step warmer/darker than the canvas.
- **Ink Charcoal** (`#2c2823` light / `#f0ece6` dark): primary text. Never true black or true white — always a warm off-tone.
- **Ink Muted** (`#6f6a62` light / `#a39d93` dark): secondary text, metadata, timestamps.
- **Ink Faint** (`#a39d93` light / `#6f6a62` dark): tertiary text, disabled states, placeholder text.
- **Hairline** (`rgba(44, 40, 33, 0.09)` light / `rgba(240, 236, 230, 0.09)` dark): borders and dividers — always a translucent tint of ink, never a flat gray.

### Status

- **Moss Success** (`#34a853` light / `#6aaa85` dark)
- **Amber Warning** (`#fbbc04` light / `#d4a54f` dark)
- **Clay Error** (`#ea4335` light / `#d4877f` dark), with **Muted Rose Error** (`#c47068`) used where error needs to blend into the accent-mix system (chip/tag backgrounds) rather than alarm.

### Named Rules

**The One Accent Rule.** Terracotta Clay is the only color the _interface itself_ is allowed to use expressively (buttons, focus, current day). Every other color on screen belongs to the user's own calendars/categories — the system mixes those colors at low opacity (`color-mix` at 5–14%) into card and chip backgrounds instead of using them as solid fills, so a calendar with a dozen categories still reads calm.

**The Warm Neutral Rule.** No token in this system is a flat gray, pure white, or pure black. Every neutral — background, border, or text — is ink or paper tinted, keeping the "aged paper" character even in dark mode.

## Typography

**Display Font:** Newsreader (with Georgia, 'Times New Roman', serif fallback)
**Body Font:** System sans stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

**Character:** A quiet serif/sans pairing — Newsreader brings warmth and a bit of editorial authority to dates, titles, and headers; the system sans stays out of the way for anything operational (buttons, forms, dense event text), so the calendar grid doesn't turn into a page of display type.

### Hierarchy

- **Display** (400, 32px, line-height 1, -0.018em): month title, week/day view title. The single largest, most confident element on any screen.
- **Headline** (500, 27px, -0.01em): the Calino brand mark / logotype in the header and sidebar.
- **Title** (500, 20px): sidebar mini-calendar month label, section headers.
- **Body** (400, 14px, line-height 1.4): default UI text, form labels, buttons, modal content.
- **Label** (500, 13px): event card titles, compact metadata, chip/tag text.

### Named Rules

**The Serif-for-Attention Rule.** Newsreader appears only where something deserves a beat of attention — the current view's date, a brand mark, a section header. It never appears in dense, repeated UI (event cards, buttons, inputs, lists) — those stay in the sans body face so the grid stays scannable at a glance.

## Layout

The app is a fixed-header, resizable-sidebar shell (`--sidebar-width: 300px` desktop, collapsible to a thin rail) over a scrollable calendar surface, with a portrait-mode split option that shares vertical space between the month grid, day view, and agenda. Header height is 76px desktop / 56px mobile. Below the 768px breakpoint, the sidebar collapses and navigation moves into a floating bottom nav pill; the layout otherwise reuses the same components rather than a separate mobile design.

Spacing follows an 8px-rooted scale (`--space-1` 4px through `--space-16` 64px), used consistently for gaps, padding, and section rhythm rather than ad hoc pixel values.

## Elevation & Depth

Flat dark, soft light — a deliberate rule, not a default. In light mode, surfaces carry gentle ambient shadows (`--shadow-event`, `--shadow-card`, `--shadow-sidebar`) that read as paper lifted slightly off the canvas; modals get a heavier, warm-tinted shadow (`--modal-shadow`) plus a subtle double-bezel border treatment. In dark mode, most of those same shadow tokens resolve to `none` — depth there comes from surface-color contrast (`--color-surface` vs `--color-surface-raised`) and border hairlines instead, because soft shadows read poorly on dark backgrounds and just muddy the surface.

### Shadow Vocabulary

- **Event** (`0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)` light / `0 1px 2px rgba(0,0,0,0.12)` dark): resting event cards — barely-there lift.
- **Event Hover** (`0 4px 12px rgba(0,0,0,0.08)` light / `rgba(0,0,0,0.2)` dark): event cards on hover/drag.
- **Card** (`0 2px 8px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.06)` light): general raised surfaces.
- **Modal** (`0 24px 80px rgba(0,0,0,0.18), 0 6px 20px rgba(0,0,0,0.10)` light / deeper + darker in dark mode): the most pronounced shadow in the system, reserved for true overlays.
- **Sidebar / Topbar**: soft ambient shadow in light mode, `none` in dark mode.

### Named Rules

**The Flat-Dark Rule.** Shadows are a light-mode device. In dark mode, elevation is expressed through surface-color steps and hairline borders, not shadow — don't port a light-mode shadow value into a dark surface unchanged.

## Shapes

Corners are gentle and consistent rather than sharp or pill-heavy: `--radius-sm` (4px) on buttons and inputs, `--radius-md` (8px) on modals and cards, `--radius-lg`/`--radius-xl` (12px/16px) on larger surfaces, `--radius-full` reserved for true circles (avatars, the close button, the day-of-week accent dot). Event cards use a distinct, slightly softer 7px radius. The brand mark is a small rotated square (a "diamond"), the one deliberately non-rectilinear shape in the system.

## Components

Buttons, inputs, and cards are calm and restrained by default: quiet neutral surfaces at rest, with the terracotta accent appearing only on the primary action or on focus/selection — never as decoration. Color communicates meaning (this is the accent, this is your calendar's color, this is an error) and nothing else.

### Buttons

- **Shape:** 4px radius (`--radius-sm`), no border.
- **Primary:** Terracotta Clay background, warm-paper text, `8px 16px` padding at the default (`md`) size; `sm`/`lg` variants scale padding and font-size (13px/16px) proportionally.
- **Secondary:** neutral hover-tint background, primary ink text.
- **Ghost:** translucent panel background at 50% opacity with a 20px backdrop blur — used for floating controls over the calendar surface.
- **Hover / Focus:** background shifts to a slightly deeper tone; `:focus-visible` gets a 2px accent-colored outline with 2px offset, never a glow-only treatment.

### Cards / Event Cards (signature component)

- **Corner Style:** 7px radius, distinct from the general 4/8/12/16 scale.
- **Background:** the event/category color mixed into the canvas at 9% (12% on hover) via `color-mix` — never a solid fill.
- **Accent Rail:** a 3px-wide, rounded color bar inset on the left edge (the category color mixed to 50% opacity) — the primary way category color reads, instead of a colored block.
- **Border:** a near-invisible 6% ink hairline.
- **Shadow Strategy:** barely-there resting shadow, slightly more pronounced on hover, paired with a 1px upward translate.
- **Text:** title in ink at label weight/size; times and metadata drop to muted ink.

### Cards / Modals & Panels

- **Corner Style:** 8px radius (`--radius-md`).
- **Background:** Paper White surface, distinct from the Warm Paper canvas behind it.
- **Shadow Strategy:** the deepest shadow in the system (see Elevation), plus (light mode only) a subtle white double-bezel border for a lifted-paper feel.
- **Motion:** fade + 20px slide-up on open, reverse on close, both on the `--dur-base` (200ms) timing.

### Inputs / Fields

- **Style:** 1px hairline border, Paper White background, 4px radius, `10px 12px` padding.
- **Focus:** border shifts to Terracotta Clay plus a 3px accent-tinted glow (`color-mix` at 15% opacity) — no layout shift.
- **Error:** border and focus glow swap to Clay Error at the same opacity treatment.

### Navigation

- **Sidebar:** card-based sections on the Parchment Side tint, resizable and collapsible to a thin icon rail; mini-calendar dates use Title-weight Newsreader for the month, sans for weekday labels.
- **Header:** the month/view Display title sits beside a segmented-control-style view/period navigator; the brand mark (rotated accent square + Headline-weight Newsreader wordmark) anchors the top-left.
- **Mobile:** sidebar and header nav are replaced by a floating bottom nav pill over the canvas, using the same ghost-button blur treatment as desktop floating controls.

## Do's and Don'ts

### Do:

- **Do** keep the terracotta accent rare — reserve it for the current day, primary actions, focus states, and the brand mark, per the One Accent Rule.
- **Do** mix user/category colors into surfaces with `color-mix` at low opacity (5–14%) rather than using them as solid fills.
- **Do** use Newsreader only for display/headline/title-level moments (dates, brand, section headers) — keep dense or repeated UI in the system sans, per the Serif-for-Attention Rule.
- **Do** drop shadows to `none` or near-`none` on dark surfaces and let color-step contrast carry elevation instead, per the Flat-Dark Rule.
- **Do** keep every neutral (background, border, text) warm-tinted — an ink or paper mix, never a flat, cool gray.

### Don't:

- **Don't** introduce a second accent color for new UI; route emphasis through Terracotta Clay or through the user's own calendar/category colors.
- **Don't** fill event or card backgrounds with a solid category color — use the accent-rail + tinted-background pattern instead.
- **Don't** carry a light-mode shadow value into dark mode unchanged; it will look muddy against the dark surface steps.
- **Don't** set Newsreader on body copy, form fields, or list-dense UI — it's reserved for hierarchy moments only.

## Accessibility

WCAG 2.1 AA is the working standard (see PRODUCT.md). The rules below are how
that standard shows up in day-to-day design work; `e2e/accessibility.spec.ts`
enforces the mechanical parts with axe-core on every surface scan.

### Contrast

- Text tokens clear 4.5:1 against every surface they appear on, in both light
  and dark themes. Ratio notes live as comments next to token values in
  `src/themes/built-in.css` — keep that convention when adjusting values.
- De-emphasis is expressed through a dedicated dimmed token (`--ink-3-dimmed`)
  at full opacity, never by stacking `opacity` on an already-muted ink —
  opacity blending is what produced the pre-0.30 failures.
- Intentional exceptions (none currently) would be documented here with their
  justification and the surfaces they apply to.

### Focus & keyboard

- Every interactive element has a visible focus ring; the app-wide
  `--focus-ring` token colors it. Programmatic focus targets (e.g. the
  skip-link destination `<main>`) suppress the ring; real keyboard focus
  never does.
- Calendar grids use roving tabindex: one Tab stop per grid, arrows move
  focus between days/hours, Enter/Space activates. New grid-like UI follows
  the same pattern (see `useRovingGrid`).
- Modals trap focus and restore it on close (`useFocusTrap`); dialogs are
  named via `aria-labelledby` pointing at their visible heading.
- A skip-to-content link is the first tabbable element on every page.

### Motion

- All animation respects `prefers-reduced-motion`: framer-motion durations
  collapse to 0 via `useReducedMotion`, and CSS animations/transitions are
  neutralized by the global rule in `index.css`. New motion must route
  through one of those two mechanisms — never raw durations.

### Semantics

- Interactive elements are real buttons/links/inputs. Composite cells (a day
  cell containing buttons) stay focusable containers without a button role —
  nested interactive controls inside a `role="button"` fail axe.
- Async state changes users need to know about (sync status, saves, progress)
  announce via `role="status"` / `aria-live="polite"`.
