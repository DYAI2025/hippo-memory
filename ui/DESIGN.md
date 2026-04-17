# Hippo Brain Observatory — Design System

## Identity

A developer tool that feels like peering into a living brain. The biological metaphor is the product, not decoration. Every visual choice reinforces organic, neural, alive.

## Color Palette

### Backgrounds
- `--bg: #0a0c10` — deep void (darker than generic #0f1117)
- `--surface: #14161e` — glass panels
- `--border: rgba(255, 255, 255, 0.06)` — subtle separation

### Text
- `--text: #e1e4ed` — primary
- `--muted: #6b7084` — secondary (slightly darker than default for more contrast)

### Accent
- `--accent: #7c5cff` — violet (neural, distinctive, not corporate blue)

### Layer Colors
- Buffer: `#7c5cff` (violet — active, working memory)
- Episodic: `#f0a030` (warm amber — time-bound)
- Semantic: `#34d399` (emerald — stable knowledge)

### Semantic
- `--green: #34d399`
- `--yellow: #f0a030`
- `--red: #f87171`
- `--purple: #a78bfa`

## Typography

### Fonts
- **Display/Header**: `'JetBrains Mono', 'Fira Code', monospace` — signals "developer tool"
- **Body**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
- **Data/Stats**: Same monospace as header

### Scale
- Title: 15px, weight 600, monospace, letter-spacing 0.5px
- Subtitle: 11px, weight 400, monospace
- Body: 13px, system
- Small: 11px, system
- Tiny: 10px, system

## Spacing

4px base unit: 4, 8, 12, 16, 20, 24, 32, 40

## Radius
- Inputs: 6px
- Tooltips/cards: 8px
- Panels: 12px

## Glass Effect

Used for header bar, tooltips, detail panel:
```css
background: rgba(10, 12, 16, 0.82);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid rgba(255, 255, 255, 0.06);
```

## Particle Rendering

### Three-layer structure (per particle)
1. **Outer halo**: radialGradient, radius × 4, layer color at 15% opacity → transparent
2. **Body**: filled circle at layer color, opacity = 0.2 + strength × 0.8
3. **Inner core**: filled circle at radius × 0.35, white at 40% opacity (gives 3D presence)
4. **Rim highlight**: 1px arc on top-left quadrant (-0.8π to -0.2π), white at 15% opacity

### Neural mesh
- Faint lines between particles within 120px distance
- Color: `rgba(255, 255, 255, 0.03)`
- Line width: 0.5px
- Skip if > 500 particles (performance)

### Canvas atmosphere
- Radial gradient background: center `#0d0f15`, edge `#080a0e`
- Dot grid: `rgba(255, 255, 255, 0.025)` dots, 1px radius, 50px spacing
- Film grain: randomized 1px dots at `rgba(255, 255, 255, 0.012)`, refreshed every 3 frames

### Zone labels
- Layer names rendered at their y-position zones
- Font: 11px monospace, `rgba(255, 255, 255, 0.05)`
- Letter-spacing: 4px, uppercase

## Interaction States

### Particle hover
- Radius grows to 1.3× over 150ms
- Outer halo brightens to 25% opacity
- Cursor changes from crosshair to pointer

### Particle selected
- White ring at radius + 3, pulsing
- Detail panel slides in from right (200ms ease-out)

### Search dimmed
- Non-matching particles: opacity × 0.08
- Matching particles: slight glow boost
- Zero results: "No matches" pill appears below search bar

### First-visit nudge
- One particle near center pulses brighter for 3 seconds
- Small label "hover to explore" fades in/out
- Only shown on first canvas render, not on subsequent data refreshes

## Responsive

- Detail panel: `width: min(340px, 45vw)`
- Below 640px viewport: panel becomes bottom sheet (full width, max 50vh)
- Glass header: always full width, height 52px

## Accessibility

- Detail panel: `role="dialog"`, `aria-label="Memory details"`, `aria-live="polite"`
- Escape key closes detail panel
- Tab key cycles through particles (via hidden button list overlaying canvas)
- Touch: tap = select (shows detail panel), no long-press needed
