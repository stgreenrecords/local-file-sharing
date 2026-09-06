---
name: Precision Dual-Pane Commander
colors:
  surface: '#10141a'
  surface-dim: '#10141a'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c22'
  surface-container: '#1c2026'
  surface-container-high: '#262a31'
  surface-container-highest: '#31353c'
  on-surface: '#dfe2eb'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dfe2eb'
  inverse-on-surface: '#2d3137'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#4de082'
  on-secondary: '#003919'
  secondary-container: '#00b55d'
  on-secondary-container: '#003e1c'
  tertiary: '#c5c9ff'
  on-tertiary: '#131e8c'
  tertiary-container: '#a3abff'
  on-tertiary-container: '#2c37a0'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#6dfe9c'
  secondary-fixed-dim: '#4de082'
  on-secondary-fixed: '#00210c'
  on-secondary-fixed-variant: '#005227'
  tertiary-fixed: '#e0e0ff'
  tertiary-fixed-dim: '#bdc2ff'
  on-tertiary-fixed: '#000767'
  on-tertiary-fixed-variant: '#2f3aa3'
  background: '#10141a'
  on-background: '#dfe2eb'
  surface-variant: '#31353c'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0em
  data-tabular-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  data-tabular-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0em
  data-tabular-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 12px
    letterSpacing: 0.02em
  keybind-label:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 2px
  space-xs: 4px
  space-sm: 6px
  space-md: 8px
  space-base: 12px
  space-lg: 16px
  space-xl: 24px
  pane-gutter: 1px
  row-compact: 22px
  row-standard: 26px
  header-height: 36px
  function-bar-height: 32px
  statusbar-height: 24px
---

## Brand & Style

This design system establishes a high-performance, precision-engineered desktop utility environment. Designed for system administrators, engineers, power users, and creative technical leads handling high-throughput local and LAN storage workflows, the aesthetic merges the translucent structural hierarchy of macOS Sequoia with the crystalline dark-surface discipline of Windows 11 Fluent Design.

The visual style is **High-Density Technical Functionalism**. The interface rejects non-functional decoration in favor of extreme tabular legibility, micro-borders (1px zinc lines), and immediate spatial orientation. Key characteristics include:
- **Zero Idle Visual Noise:** Controls remain low-contrast until focused, hovered, or invoked via keybinds.
- **Instrumental Precision:** Information density mimics developer tooling and aviation heads-up displays; row heights, byte counters, and checksums are laid out along strict vertical optical guides.
- **High-Contrast Telemetry Accents:** High-vibrancy electric cyan and phosphor neon green highlight instantaneous file operations, bandwidth spikes, and directional LAN state changes against deep charcoal foundations.

## Colors

The palette operates in strict dark-mode-first hierarchy, engineered for OLED/HDR monitors and long workstation sessions without optical fatigue.

### Color Tiers & Roles
- **Base Canvas (`#0d1117`):** Primary viewport backdrop, root window container, and inactive pane background.
- **Panel Surface (`#161b22`):** Active file panes, directory trees, and toolbar modules. Provides distinct spatial grouping without heavy elevation.
- **Elevated Canvas (`#21262d`):** Popovers, context menus, quick-look previews, and modal sheets.
- **Structural Borders (`#30363d`):** Strict 1px panel dividers, column delimiters, and input wrappers.
- **Hover/Selected Borders (`#6e7681`):** Window-active pane outlines and drop-target boundaries.

### Signal & Accent Palettes
- **Electric Cyan (`#38bdf8` - Primary):** Focus rings, active pane titlebars, navigation breadcrumbs, and selected row indicators.
- **Phosphor Green (`#4ade80` - Secondary):** Throughput rates (MB/s, Gbps), transfer completion rings, verified checksums, and active LAN handshake nodes.
- **Indigo Pulse (`#818cf8` - Tertiary):** Queue workers, staging bins, symlinks, and background synchronization monitors.
- **Telemetry Amber (`#fbbf24`):** File collision warnings, locked handles, network throttles, and overwrite confirmations.
- **Telemetry Rose (`#f43f5e`):** IO errors, corrupted sectors, disconnected peers, and dropped packets.

### Text & Glyph Hierarchy
- **Text Primary (`#f0f6fc`):** Filenames, active directory paths, column values.
- **Text Secondary (`#8b949e`):** File metadata (file sizes, modified dates, permissions, file extensions).
- **Text Tertiary / Ghost (`#484f58`):** Inactive keybindings, grid guides, root drive mount annotations.

## Typography

Typography prioritizes high-density vertical alignment, rigid tabular scanning, and character disambiguation (e.g., `0` vs `O`, `1` vs `l` vs `I`).

- **Primary UI Sans (`Geist`):** Delivers clean, low-contrast neutral glyphs optimized for dense desktop UI frames, path breadcrumbs, menu items, and dialog bodies.
- **Monospaced Engine (`JetBrains Mono`):** Applied systematically to all file listings, file sizes, checksums, transfer speeds, timestamp columns, and function key indicators. All numbers must render with `font-variant-numeric: tabular-nums lining-nums`.
- **Text Truncation Rule:** Directory and file lists truncate via middle-ellipsis (`/Users/.../bin/release.tar.gz`) rather than tail truncation to preserve file extensions and root prefixes.

## Layout & Spacing

The layout is built around a deterministic, dual-pane layout model optimized for multi-pane split workflows (Source/Target).

### Layout Geometry
- **Top Utility & Title Bar:** 36px fixed height housing unified window controls, search indexer, breadcrumbs, and network node selectors.
- **Dual-Pane Work Area:** 50/50 split viewport with an adjustable 1px resize splitter (`pane-gutter`). Panes dynamically scale down to a min-width of 360px before allowing horizontal overflow or auto-collapsing secondary panes.
- **Bottom Function Key Bar (F3 - F8):** 32px fixed height across the window baseline, split into 6 uniform grid cells or dynamic proportional triggers.
- **Global Statusbar:** 24px fixed height at the lowest visual plane displaying aggregate item count, free storage capacity, and live LAN socket health.

### Sizing & Grid Density
All spacing operates on an absolute 4px/2px sub-grid:
- Table item row heights are locked to `22px` (compact mode) and `26px` (standard mode) to guarantee maximum visible item counts per display view.
- Padding inside table cells is clamped at `4px 8px` horizontally, reducing horizontal scan distance.

## Elevation & Depth

This system avoids heavy drop shadows, employing subtle macOS translucent materials layered over Windows 11 Fluent acrylic patterns and 1px borders.

### Surface Tiers & Translucency
1. **Desktop Shell (Level 0):** `#0d1117` at 85% opacity with `backdrop-filter: blur(24px) saturate(140%)`. This allows subtle desktop wallpapers or lower IDE windows to provide faint ambient tinting through window header bars and inactive panes.
2. **Active Work Pane (Level 1):** `#161b22` fully opaque. When a pane becomes active (focused), it gains a crisp outline: `inset 0 0 0 1px #38bdf844`, visually detaching it from the companion pane.
3. **Floating Drawers / Inspections (Level 2):** `#21262d` with 1px border `#30363d` and shadow: `0 8px 24px -4px rgba(0, 0, 0, 0.65), 0 2px 6px -1px rgba(0, 0, 0, 0.4)`.
4. **Context Menus & Command Palette (Level 3):** `#161b22` with 95% opacity, `backdrop-filter: blur(16px)`, 1px border `#484f58`, and shadow `0 16px 36px -8px rgba(0, 0, 0, 0.85)`.

### Depth via Inset Borders
Depth is expressed through inner and outer hairline borders rather than spatial distance. Recessed elements (progress bars, terminal viewports, search text fields) feature an inset 1px border rendered in `#0d1117` with an interior background of `#080b0f`.

## Shapes

To maintain high density and precise tabular alignment, UI elements use tight corner radiuses (Soft / `level 1`). 

- **App Shell & Main Panes:** `0px` radius at outer window seams and pane splits; sharp boundaries maximize viewport surface area.
- **Interactive Controls (Buttons, Inputs, Selectors):** `4px` (`0.25rem`) corner radius.
- **Function Key Tiles (F3–F8):** `2px` (`0.125rem`) corner radius to create tightly packed macro-key aesthetic.
- **Badges, Status Dots & Metric Pills:** `4px` rounded containers; circular indicators (`9999px`) reserved exclusively for real-time connection status LEDs.
- **Modal Containers & Flyouts:** `8px` (`0.5rem`) corner radius to soften floating system interventions.

## Components

### 1. Dual-Pane File Table
- **Row Anatomy:** 3-part layout: Status icon / Selection checkbox (16px), File/Folder Icon + Name (`body-md`), Tabular Data columns (`data-tabular-md` for Size, Type, Modified Date, Attributes).
- **Row States:**
  - *Default:* Transparent background, `#f0f6fc` filename text.
  - *Hover:* Background `#21262d80` with smooth transition (`80ms ease-out`).
  - *Selected (Focused Pane):* Background `#38bdf822` with an electric cyan left accent mark (`2px solid #38bdf8`).
  - *Selected (Inactive Pane):* Background `#30363d66`, border indicator changes to `#8b949e`.
  - *Staged for Transfer:* Phosphor green text tint `#4ade80` with dashed understroke.

### 2. Keyboard Shortcut Command Bar (F3 - F8)
- Grounded horizontal dock pinned to the bottom of the viewport.
- Split into 6 equal tiles corresponding to classic commander conventions: `F3 View`, `F4 Edit`, `F5 Copy`, `F6 Move`, `F7 New Folder`, `F8 Delete`.
- **Button Tokens:** Background `#161b22`, border `1px solid #30363d`, text `#f0f6fc`.
- **Key Badge:** The function key numeral prefix (`F3`, `F5`) is rendered in `JetBrains Mono 10px Bold` using `#38bdf8` inside a `#38bdf81a` container.
- **Interaction:** Depresses vertically by `1px` with a active highlight border on physical keypress.

### 3. Transfer Telemetry & Progress Bars
- **Progress Gauge:** Track height `4px`, background `#21262d`, filled with a dynamic linear-gradient (`#38bdf8` to `#4ade80`).
- **Transfer Drawer/HUD:** Displays current file stream, transfer speed (`MB/s` rendered in `data-tabular-lg` with `#4ade80`), dynamic ETA, and total progress.
- **LAN Ping Indicator:** Small tabular badge (`12ms`) colored green `<20ms`, amber `<100ms`, and rose `>100ms`.

### 4. Input Fields & Breadcrumb Path Bar
- Path bar is interactive: click on background activates raw text entry mode (`JetBrains Mono 12px`); clicking path tokens behaves as an instant directory drill-down dropdown.
- Background `#0d1117`, border `1px solid #30363d`, focus-ring `1px solid #38bdf8` (no fuzzy glow).

### 5. Selection Indicators & Checkboxes
- Checkboxes: 14x14px squares, `2px` radius. Empty state uses `1px solid #484f58`. Checked state features `#38bdf8` fill with `#0d1117` micro-check glyph.
- Cursor highlights support continuous keyboard range selection (`Shift + Up/Down`) with instant active-count recalculation in the pane sub-header.