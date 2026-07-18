# Handoff: Calino Mobile Navigation Redesign

## Overview
Redesign of Calino's (calendar app) mobile navigation. Replaces the old top-corner view switcher with a single floating bottom pill that houses: sidebar access, view switching, view expansion, and item creation. Goal: reduce chrome, keep the aesthetic light/unobtrusive (iOS-27-style floating pill, not edge-to-edge), and make all 8 app views reachable from one control without a separate tab bar or nav drawer trigger conflicting with edge-swipe gestures.

## About the Design Files
The files in this bundle (`Calino Prototype.dc.html`, `Calino Navigation Redesign.dc.html`, `support.js`) are **design references** — interactive HTML/JS prototypes built in an internal design tool to demonstrate exact look, spacing, and behavior. They are not production code. Open `Calino Prototype.dc.html` directly in a browser (it's self-contained with `support.js` alongside it) to interact with the real thing — every control in it is functional (view switching, swipe navigation, sidebar, expand/collapse animations, task checkboxes, theme/settings toggles).

**Task**: recreate this design in Calino's actual codebase/framework (whatever it is — React Native, SwiftUI, native Android, etc.), using the app's existing component patterns, design tokens, and state management — not by embedding this HTML. `Calino Navigation Redesign.dc.html` contains the earlier concept explorations (bottom tab bar, persistent toolbar, gesture-first) for context on alternatives considered; the floating pill in `Calino Prototype.dc.html` is the one selected and should be the implementation target.

## Fidelity
**High-fidelity.** Colors, spacing, radii, typography, and animation timings below are final and should be matched pixel-for-pixel where the target platform allows equivalent primitives (e.g. translate SwiftUI corner radius / spring animations to match, don't just "get close").

## Navigation Structure

### The floating pill (bottom nav)
A single rounded white pill floating above the content, `14px` inset from both side edges and the bottom safe area, with a soft drop shadow. It has three states, sized by animating `height` + `border-radius` (`transition: height 0.32s cubic-bezier(0.65,0,0.35,1), border-radius 0.32s`):

| State | Height | Radius | Trigger |
|---|---|---|---|
| Base | 57px | 34px | default |
| Expanded (view grid) | 138px (+169px if quick-settings open) | 30px | tap "···" |
| Create drawer | 210px | 26px | tap "+" |

**Base row** (always at the bottom of the pill, `padding: 6px 8px 7px 4px`, `gap: 5px`, flex row):
1. **Hamburger button** — 44×44px tap target, 3-line icon (`stroke:#2c2823`, `stroke-width:2`), opens the sidebar. Animates to `width:0, opacity:0` when the switcher is expanded (frees horizontal space).
2. **View switcher segment** — flex:1, a 4-column grid pill (bg `#f6f3ed`, radius 20px, padding 2px, gap 2px) containing 3 view buttons (Month/Week/Agenda — whichever 3 the user is currently cycling through) plus a 4th "···" button. Each view button: text label (not icon-only), `font-size:11px`, active state = `background:#b07d4f`, `color:#fff`, `font-weight:700`; inactive = transparent bg, `color:#8a8377`, `font-weight:400`. Corner radius on buttons: 17px. The "···" button is an ellipsis-dots icon, same tap target, toggles expansion.
3. **"+" create button** — 38×38px circle, `background:#b07d4f`, white plus icon that rotates 45° (becoming an "×") when the create drawer is open. Also animates to `width:0, opacity:0` when the switcher is expanded.

### "···" expanded state (view grid)
The switcher segment grows to fill the whole pill width (background goes transparent, its own inner cards carry backgrounds) and stacks vertically (`gap:8px`):
1. **Search / Settings row** — a `background:#f0ebe1, radius:12px, padding:4px` bar containing: a "Search" tile (flex:1, white bg, radius 9px, icon+label) and a combined Settings tile (flex:1.4, white bg, radius 9px) split into two tap zones by a 1px divider — left zone (flex:1) opens full Settings view on tap; right zone (30px wide) is a sliders icon that toggles the **quick-settings inline panel** without navigating away. The quick-settings toggle button itself fills orange (`#b07d4f`) with white icon when active.
2. **Quick-settings panel** (conditionally shown, adds 169px to pill height) — white card, radius 14px, padding 13px/14px, containing: Theme selector (System/Light/Dark, 3 icon buttons in a `#f6f3ed` track), a divider, "Week numbers" toggle switch, "Hide completed tasks" toggle switch, and a text link "All settings →" that navigates to full Settings. Toggle switches: 38×21px track, `#b07d4f` when on / `#e3ddd0` when off, white 17px knob sliding between `left:2px` and `left:20px`.
3. **8-view grid** — `display:grid, grid-template-columns:repeat(4,1fr), gap:5px`, background `#f0ebe1` (the "beige track" — only appears behind this grid, nowhere else in the pill), padding 5px. Contains all 8 views as slim tiles: Month, Week, Agenda, Year, Day, Tasks, Journal, Contacts. Active tile: `background:#b07d4f`, white bold text, subtle shadow (`0 3px 8px rgba(176,125,79,0.35)`). Inactive: transparent bg, `color:#8a8377`, weight 400. Tapping any tile switches view and collapses the switcher back to base state.

A full-screen invisible tap-catcher (`position:absolute; inset:0`) sits behind the pill while expanded so tapping anywhere in the content area collapses it.

### "+" create drawer
Slides the pill up to 210px, revealing (top to bottom): a 34×5px grey drag-handle/dismiss affordance (also clickable, closes drawer), then three full-width list rows (44px tall, `gap:12px` between icon and label, `border-radius:10px` on hover/press) — "New Event", "New Task", "New Journal Entry" — each with an outline icon (`stroke:#8a8377`) and 14px label. Tapping any row currently just closes the drawer in the prototype (icon-only affordance, actual creation flow is out of scope for this design pass — wire up real create flows per item).

### Sidebar
Triggered by hamburger. Full-height panel, 250px wide, slides from the left, `background:#faf8f3`, drop shadow `6px 0 24px rgba(0,0,0,0.12)`, over a `rgba(44,40,33,0.32)` scrim (tapping scrim closes it). Padding 22px/16px, vertical stack (`gap:16px`):
1. **Brand row** — 14px dot (`#b07d4f`) + "Calino" wordmark, Georgia serif, 19px.
2. **Mini calendar card** — white, radius 14px, padding 12px. Month label header with ◀/▶ (currently decorative in the prototype — wire to real month nav), 7-col weekday letters row, then the month grid: each cell 6px radius, selected day = solid `#b07d4f` fill/white text, today = `#efe7db` fill, out-of-month days at 0.5 opacity. Below the grid, a full-width "Today" button (transparent bg, `1px solid rgba(176,125,79,0.3)` border, `#b07d4f` text, radius 10px).
3. **Tasks section** — "Tasks · N" uppercase label (11px, `#a39d93`, letter-spacing 0.03em), up to 4 task rows (14px circle checkbox outline + title + due-date in accent/red if overdue), then a "View all →" link that navigates to the full Tasks view.

### Content area gestures
Swipe left/right on the main content area (not just header chevrons) changes the date period for the current view: month view moves by 1 month, week/agenda by 7 days, day view by 1 day, year view by 1 year. Threshold: 60px horizontal touch delta. Header chevrons perform the identical navigation and always flank the centered title (Georgia serif, 24px) when the current view supports date paging (all except Tasks/Journal/Contacts/Search/Settings, which hide the chevrons and the 3-dot page indicator below the header).

## Design Tokens

**Colors**
- Background (app canvas): `#ece7dd`
- Surface / cards: `#ffffff`
- Sidebar / sheet background: `#faf8f3`
- Track/beige backgrounds (switcher base, views-grid track, search bar bg): `#f6f3ed` (switcher), `#f0ebe1` (views-grid track, search/settings row)
- Primary accent (active states, CTA, links): `#b07d4f`
- Primary accent hover: `#8f6440`
- Primary text: `#2c2823`
- Secondary/muted text: `#8a8377` (inactive nav labels), `#a39d93` (metadata, placeholders), `#c2bcae` (disabled/out-of-range)
- Overdue/destructive accent: `#c2697f`
- Success/done accent: `#5a8a5a`
- Event category colors (sample set — extend per real calendar categories): teal `#3fa79c`, green `#5a8a5a`, amber `#c99a3a`, purple `#8b6bb0`
- Scrim: `rgba(44,40,33,0.32)`
- Divider lines: `rgba(44,40,33,0.06)`–`rgba(44,40,33,0.1)` depending on context

**Typography**
- Headings/title (view title, brand wordmark): Georgia / Times New Roman serif, 24px (view title), 19px (brand)
- UI text: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`)
- Body sizes used: 11px (labels/metadata), 11.5–12.5px (secondary text, nav labels), 13.5–14px (primary row text), 15px (week-view date numbers)
- Weight: 400 default, 600 for emphasized rows/dates, 700 for active nav state and today's date

**Radii**
- Pill (base): 34px · Pill (expanded): 30px · Pill (create): 26px
- Cards: 12–14px · Nav segment buttons: 17px · Small buttons/icons: 6–10px · Toggle tracks: 11px (pill-shaped) · Avatar/dots: 50%

**Shadows**
- Floating pill: `0 16px 36px rgba(44,40,33,0.20), 0 2px 10px rgba(44,40,33,0.10)`
- Cards: `0 1px 2px rgba(0,0,0,0.04)`
- Active view-grid tile: `0 3px 8px rgba(176,125,79,0.35)`
- Sidebar panel: `6px 0 24px rgba(0,0,0,0.12)`

**Spacing / sizing**
- Pill side/bottom inset: 14px (bottom adds `env(safe-area-inset-bottom)`)
- Tap targets: hamburger/switcher buttons 44px min height, create button 38px circle
- Base pill row padding: `6px 8px 7px 4px`, gap 5px between hamburger / switcher / create button

**Motion**
- Pill resize: `height 0.32s cubic-bezier(0.65,0,0.35,1)`, `border-radius 0.32s` (same curve)
- Chrome fade (hamburger/create shrink when switcher opens): `all 0.25s`
- Create icon rotation (+  → ×): `transform 0.25s`, 0deg → 45deg
- Toggle knob slide: `left 0.2s`

## State Management
Minimum state needed to drive this nav:
- `currentDate` (the date/period being viewed)
- `currentView` — one of month / week / agenda / year / day / tasks / journal / contacts / search / settings
- `recentViews` (3-item list) — which 3 views show as the persistent quick-switch row; update this when the user picks a view from the "···" grid so their most-used 3 surface by default (the prototype hardcodes Month/Week/Agenda — recommend making this adaptive, or confirm with design if it should stay fixed)
- `sidebarOpen: boolean`
- `viewSwitcherExpanded: boolean` ("···" state)
- `quickSettingsOpen: boolean` (nested under switcher-expanded)
- `createDrawerOpen: boolean`
- Mutual exclusivity: opening any one of sidebar / switcher-expanded / create-drawer should close the others (see `toggleSidebar`/`toggleMore`/`toggleCreate` in the prototype's logic — each clears the other two flags)
- Theme mode (system/light/dark), "week numbers" boolean, "hide completed tasks" boolean — persisted user settings, editable both from full Settings and from quick-settings

## Interactions & Behavior
- Tap hamburger → open sidebar (slide-in from left + scrim); tap scrim or hamburger again → close.
- Tap a view label in the base switcher → switch view instantly (no animation on the content, instant swap in the prototype — content transition style is left to the target platform's conventions).
- Tap "···" → pill grows in place to reveal full 8-view grid + search/settings row; tap outside the pill (anywhere in content) or tap "···" again → collapse.
- Tap the small sliders icon next to "Settings" → inline quick-settings panel expands within the already-expanded pill (adds height, no navigation); tap again → collapses just that panel.
- Tap "Settings" text (not the sliders icon) → navigates to full Settings view and collapses the switcher.
- Tap any tile in the 8-view grid → switch to that view and collapse the switcher back to base.
- Tap "+" → pill grows upward into a create drawer (drag-handle + 3 actions); tap handle, tap "+" again, or select an action → collapses.
- Swipe left/right on content (60px threshold) or tap header chevrons → move the current view's date period by one unit (month/week/day/year depending on view).
- Tap a day cell in Month view → switch to Day view for that date.
- Tap a day column in Week view → switch to Day view for that date.
- Tap a month tile in Year view → switch to Month view for that month.
- Tap a task's circular checkbox → toggle complete (strikethrough + green fill/border).
- Sidebar: tap a mini-calendar day → jump main view to that date and close sidebar; tap "Today" → jump to today; tap "View all →" → open full Tasks view.

## Assets
No external image/icon assets — all icons are inline SVG (stroke-based, `stroke-width` 1.8–2.4, using the muted `#8a8377` or primary `#2c2823`/`#fff` per context). No custom fonts loaded; serif headings use the system-available Georgia/Times New Roman, body uses the OS system font stack. Recreate icons with the target platform's icon system (e.g. SF Symbols) matching the glyphs shown (hamburger = 3 lines, search = magnifying glass, settings = gear-ish concentric circles, sliders = 3 lines with dots, plus = cross, checkmark for tasks, calendar/clock glyphs per row icon in the create drawer).

## Files
- `Calino Prototype.dc.html` — the final interactive prototype implementing everything described above. Open directly in a browser (with `support.js` in the same folder) to try every interaction.
- `Calino Navigation Redesign.dc.html` — earlier concept explorations (bottom tab bar / persistent toolbar / gesture-first alternatives) kept for context; not the target design.
- `support.js` — runtime required by the two `.dc.html` files to render in a browser; not relevant to the target codebase.
