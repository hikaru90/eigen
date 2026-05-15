# Design System

Two visual styles guide the project's aesthetic vocabulary. Both are described below with colors remapped to the canonical brand palette.

---

## Style 1: Brand Slider (Warm Minimalist / Data-Visualization)

A brand positioning diagram built around high whitespace, a glowing data path, and weighted node hierarchy. The palette leans organic and understated so that the luminous connecting line commands full attention.

### Color Mapping

| Role | Brand Token | Hex |
|---|---|---|
| Canvas Background | Off-White | `#F6F0E6` |
| Glow Primary (connecting path) | Aquamarine | `#9BF0E1` |
| Highlight Node | Tangerine | `#FF4632` |
| Typography & Nodes | Black | `#191414` |
| UI Accents / pill containers | Warm Gray | `#C3C3B6` |

### Typography & Layout

- **Font:** Modern Sans-Serif (Inter, Aeonik, or Graphik).
- **Transform:** All-caps labels — conveys authority and structure.
- **Weight:** Medium / Semi-bold for small-size legibility.
- **Alignment:** Left/right-justified labels flanking a centered horizontal axis per slider row.

### Visual Language

- **Liquid Path:** A blurred, semi-transparent Aquamarine stroke (`opacity: 40–60%`, `blur: 30–50px`) connects primary nodes. Mimics bioluminescent glow against the Off-White field.
- **Node Hierarchy:** Varying circle diameters encode weight or multiple data points, implying depth and priority without 3D.
- **Glassmorphism Lite:** Pill-shaped toggle buttons (e.g. "Classic / Futuristic") use Warm Gray backgrounds with `border-radius: 20px` and subtle backdrop shifts.
- **Texture:** A faint grain or paper texture over the Off-White background prevents a "flat digital" appearance.

### Brand Positioning Encoded

| Dimension | Positioning |
|---|---|
| Temperament | Lean towards Optimistic |
| Era | Strongly Futuristic (highlighted node) |
| Persona | Strongly Supportive |
| Reliability | Strongly Trustworthy |
| Origin | Balanced, slightly Human-Focused |

---

## Style 2: Geometric Constructivist (Scandi-Tech / Blueprint)

An architectural diagram meets Bauhaus-inspired composition. Strict grid geometry, monospace type, and a muted retro palette create an "engineer's notebook" feel.

### Color Mapping

| Role | Brand Token | Hex |
|---|---|---|
| Canvas Background | Warm Gray | `#C3C3B6` |
| Primary accent | Tangerine | `#FF4632` |
| Secondary accent | Pale Mint | `#B8E9D0` |
| Tertiary accent | Vibrant Pink | `#FE86B1` |
| Quaternary accent | Sky Blue | `#A3D8F4` |
| Highlight / energy | Citric | `#CDF564` |
| Primary node & connectors | Black | `#191414` |

### Typography & Grid

- **Font:** Monospace (Roboto Mono, IBM Plex Mono, or Courier).
- **Character:** Small floating numbers add a "process" / "blueprint" quality.
- **Layout:** Strict 8×8 grid. Elements snap to intersections or cell centers — mathematical precision is the point.

### Visual Language

- **Connective Tissue:** Thin `1–2px` Black paths using Manhattan geometry (90° and 45° angles only). Evokes circuit boards or logical flowcharts.
- **Nodes:** Borderless, shadow-free circles. Overlapping creates depth without 3D.
- **Grid:** Hairline grid in a lighter tint of Warm Gray provides structural skeleton without competing with content.
- **Approach:** "Constrained randomness" — place nodes organically, but snap every connector to 45° or 90°.

### Style Attributes

| Element | Direction |
|---|---|
| Aesthetic | Functionalist / Information Art |
| Composition | Asymmetrical but balanced |
| Line Work | Precision-weighted, non-tapered |
| Depth | Flat (2D) with layering |

---

## Shared Principles

- Whitespace is structural, not decorative. Both styles treat empty space as an active layout element.
- Color signals intent: Tangerine for urgency/highlight, Aquamarine/Citric for energy/accent, neutrals for everything structural.
- Typography is restrained — one family per style, tight weight range, no decorative variation.
- All brand colors are sourced from [`docs/brand-palette.md`](brand-palette.md). Do not introduce off-palette colors without updating that file first.
