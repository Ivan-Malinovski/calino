# Theming Guide

Calino's appearance is fully customizable via CSS. Themes are loaded at build time — drop a `.css` file into `public/themes/` and rebuild.

## Quick Start

1. Copy `public/themes/.theme-template.css` to `public/themes/my-theme.css`
2. Edit the CSS variables and/or component overrides
3. Run `pnpm build` (or restart `pnpm dev`)
4. Open Settings → Theme → select your theme

## Built-in Themes

| Theme            | Mode  | Description                                                      |
| ---------------- | ----- | ---------------------------------------------------------------- |
| Default Light    | light | Warm editorial palette with serif accents                        |
| Default Dark     | dark  | Warm dark variant of the default                                 |
| Slate            | dark  | Cool blue-gray dark theme                                        |
| Mist             | light | Soft neutral gray                                                |
| Mist Dark        | dark  | Dark variant of Mist                                             |
| Mist Green       | light | Sage green tinted                                                |
| Mist Green Dark  | dark  | Dark variant of Mist Green                                       |
| Xiaohongshu      | light | Warm cream with coral accent                                     |
| Xiaohongshu Dark | dark  | Dark variant of Xiaohongshu                                      |
| Bauhaus          | both  | Bold geometric primary colors                                    |
| Brutalist        | both  | High-contrast black/yellow, raw edges                            |
| Adjustable       | both  | User-controlled colors, radius, density, shadows, and event tint |

Adjustable is also available from Appearance settings as **Adjustable Light**
and **Adjustable Dark**. Its controls edit the active mode live; the saved
light and dark profiles are independent and are included in settings sync.

## Theme File Format

### Header (required, line 1)

Every theme file must start with a comment declaring its name and mode:

```css
/* Theme: My Theme | light */ /* light-only */
/* Theme: My Theme | dark */ /* dark-only */
/* Theme: My Theme | both */ /* both light + dark sections */
```

- **`light`** — appears in the Light Theme dropdown
- **`dark`** — appears in the Dark Theme dropdown
- **`both`** — appears in both dropdowns. The file must contain both `:root, [data-theme='light']` and `[data-theme='dark']` sections. The loader registers it as two entries (`mytheme-light` and `mytheme-dark`).

If no header is found, the filename is used as the theme name (e.g., `nord.css` → "Nord").

### CSS Variables (Part 1)

Set CSS custom properties on `:root, [data-theme='light']` and/or `[data-theme='dark']`:

```css
:root,
[data-theme='light'] {
  --canvas: #faf8f3; /* page background */
  --panel: #ffffff; /* cards, modals, sidebar */
  --ink: #2c2823; /* primary text */
  --accent: #b07d4f; /* buttons, links, highlights */
  /* ... see template for full list */
}

[data-theme='dark'] {
  --canvas: #1a1816;
  --panel: #242220;
  --ink: #f0ece6;
  --accent: #c9956a;
}
```

Your rules come after the built-in CSS in the cascade, so they override the defaults on equal specificity.

### Component Overrides (Part 2)

For effects that CSS variables can't express (gradients, backdrop-filter, custom borders), target elements using `data-component` attributes:

```css
[data-theme-id='mytheme'] [data-component='sidebar'] {
  background: rgba(30, 30, 35, 0.7);
  backdrop-filter: blur(12px) saturate(1.4);
}
```

The `data-theme-id` is your CSS filename without the `.css` extension.

## CSS Variable Reference

### Two tiers of variables

Calino exposes **two tiers** of CSS variables:

| Tier               | Variables                                                                                                                                                  | Status     | What to set                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| **Canonical**      | `--canvas`, `--panel`, `--ink`, `--ink-2`, `--ink-3`, `--accent`, `--accent-soft`, `--line`, `--line-2`                                                    | Primary    | Always set these in your theme                                   |
| **Legacy aliases** | `--color-bg-primary`, `--color-text-primary`, `--color-border`, `--color-accent`, `--color-bg-secondary`, `--color-accent-hover`, `--color-bg-hover`, etc. | Deprecated | Optional; auto-derived from canonical tier in the built-in theme |

Theme authors should set **only the canonical tier**. The legacy aliases are provided for backward compatibility with existing third-party themes.

### Colors

| Variable        | Description                                              |
| --------------- | -------------------------------------------------------- |
| `--canvas`      | Page background (canonical)                              |
| `--panel`       | Card/modal/sidebar background (canonical)                |
| `--side`        | Sidebar background                                       |
| `--ink`         | Primary text color (canonical)                           |
| `--ink-2`       | Secondary text                                           |
| `--ink-3`       | Muted/tertiary text                                      |
| `--line`        | Primary border color (canonical)                         |
| `--line-2`      | Subtle border color                                      |
| `--accent`      | Primary accent — buttons, links, highlights (canonical)  |
| `--accent-soft` | Light accent background for chip/badge fills (canonical) |
| `--ink-raw`     | RGB triplet (e.g., `44, 40, 33`) for use in `rgba()`     |

### Shadows

| Variable               | Description               |
| ---------------------- | ------------------------- |
| `--shadow-event`       | Event card resting shadow |
| `--shadow-event-hover` | Event card hover shadow   |
| `--shadow-card`        | Generic card shadow       |
| `--shadow-sidebar`     | Sidebar shadow            |
| `--shadow-topbar`      | Header shadow             |
| `--shadow-today`       | Today cell highlight      |
| `--shadow-glass`       | Glassmorphism shadow      |
| `--shadow-inset`       | Inset shadow for inputs   |

### Layout

| Variable                    | Description                 |
| --------------------------- | --------------------------- |
| `--radius-sm`               | Small border radius (7px)   |
| `--radius-md`               | Medium border radius (11px) |
| `--radius-lg`               | Large border radius (16px)  |
| `--event-border-radius`     | Event card corners          |
| `--sidebar-width`           | Sidebar width (300px)       |
| `--sidebar-collapsed-width` | Collapsed sidebar (40px)    |

### Calendar Grid

| Variable                    | Description                             |
| --------------------------- | --------------------------------------- |
| `--day-cell-radius`         | Day cell corner radius                  |
| `--day-cell-hover-bg`       | Day cell hover background               |
| `--day-cell-today-bg`       | Today cell background                   |
| `--day-cell-other-month-bg` | Days outside current month              |
| `--multi-day-clip`          | Polygon shape for multi-day event arrow |

### View Switcher

| Variable                           | Description           |
| ---------------------------------- | --------------------- |
| `--view-switcher-bg`               | Tab bar background    |
| `--view-switcher-radius`           | Tab bar corner radius |
| `--view-switcher-indicator-bg`     | Active tab background |
| `--view-switcher-indicator-shadow` | Active tab shadow     |
| `--view-switcher-indicator-radius` | Active tab corners    |

### Typography

| Variable       | Description          |
| -------------- | -------------------- |
| `--font-sans`  | UI font stack        |
| `--font-serif` | Serif font stack     |
| `--font-mono`  | Monospace font stack |

## Available `data-component` Selectors

These are plain HTML attributes on elements — they persist regardless of CSS Module class name hashing.

| Selector                                  | Element                          |
| ----------------------------------------- | -------------------------------- |
| `[data-component="sidebar"]`              | Sidebar panel                    |
| `[data-component="header"]`               | Top bar / calendar header        |
| `[data-component="view-switcher"]`        | Month/Week/Day/Agenda tabs       |
| `[data-component="today-button"]`         | "Today" button in header         |
| `[data-component="calendar-grid"]`        | Main calendar grid               |
| `[data-component="event-card"]`           | Event pill in any view           |
| `[data-component="event-preview"]`        | Event hover popup                |
| `[data-component="modal-backdrop"]`       | Modal overlay/scrim              |
| `[data-component="modal-card"]`           | Modal content card               |
| `[data-component="modal-band"]`           | Event modal accent strip         |
| `[data-component="modal-body"]`           | Event modal scrollable body      |
| `[data-component="modal-footer"]`         | Event modal action buttons       |
| `[data-component="command-palette"]`      | Power bar / Cmd+K palette        |
| `[data-component="tasks-section"]`        | Sidebar tasks panel              |
| `[data-component="day-tasks"]`            | Tasks row in month cell          |
| `[data-component="sidebar-today-button"]` | Today button in sidebar mini-cal |
| `[data-component="toggle"]`               | Toggle switch in settings        |
| `[data-component="all-day-event"]`        | All-day event row                |
| `button[data-variant="primary"]`          | Primary action buttons           |

### Day Cell Attributes

| Selector             | Element                   |
| -------------------- | ------------------------- |
| `[data-today]`       | Today's date cell         |
| `[data-other-month]` | Day outside current month |
| `[data-weekend]`     | Saturday / Sunday         |
| `[data-drop-target]` | Drag-over state           |

### Event Attributes

| Selector           | Element                  |
| ------------------ | ------------------------ |
| `[data-multi-day]` | Multi-day spanning event |

## Examples

### Frosted Glass Sidebar (dark mode only)

```css
[data-theme-id='mytheme'][data-theme='dark'] [data-component='sidebar'] {
  background: rgba(30, 30, 35, 0.7);
  backdrop-filter: blur(12px) saturate(1.4);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
```

### Double-Bezel Modal

```css
[data-theme-id='mytheme'] [data-component='modal-backdrop'] {
  backdrop-filter: blur(6px);
}

[data-theme-id='mytheme'] [data-component='modal-card'] {
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.1),
    0 24px 80px rgba(0, 0, 0, 0.25);
}
```

### Today Cell Glow

```css
[data-theme-id='mytheme'] [data-today] {
  box-shadow:
    inset 0 0 0 2px var(--accent),
    0 0 12px color-mix(in srgb, var(--accent) 20%, transparent);
}
```

### Custom Toggle Colors

```css
[data-theme-id='mytheme'] [data-component='toggle'] > span:nth-child(2) {
  background: var(--ink-3);
}

[data-theme-id='mytheme'] [data-component='toggle'] > span:nth-child(3) {
  background: var(--accent);
}
```

### Event Preview Popup

```css
[data-theme-id='mytheme'] [data-component='event-preview'] {
  background: rgba(var(--ink-raw), 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
}
```

### Primary Action Buttons

```css
[data-theme-id='mytheme'] button[data-variant='primary'] {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
}
```

## Tips

- **Start simple.** Changing just `--canvas`, `--panel`, `--ink`, and `--accent` gives you a complete theme.
- **Use `color-mix()`** for dynamic opacity: `color-mix(in srgb, var(--accent) 12%, transparent)`.
- **Use `rgba(var(--ink-raw), 0.1)`** for borders and hovers that adapt to the theme's text color.
- **Test both modes.** If your theme uses `| both`, make sure the dark section has proper contrast.
- **The template is your reference.** `public/themes/.theme-template.css` lists every available variable with sensible defaults.
