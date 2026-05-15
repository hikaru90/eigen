# Brand Color Palette

Canonical color set for the project. Used as the source of truth for graph node fills, UI accents, and any future theming work.

## Core Brand Colors

| Name | Hex | Role |
|---|---|---|
| Klein Blue | `#4100F5` | Primary Brand / Action Color — deep electric ultramarine |
| Citric | `#CDF564` | High-contrast Accent — high-vis yellow-green |
| Aquamarine | `#9BF0E1` | Secondary / Cool Neutralizer — soft minty cyan |
| Fushia | `#F037A5` | Statement Accent — vibrant saturated magenta |
| Tangerine | `#FF4632` | Warning / Urgency / CTA — warm aggressive red-orange |
| Black | `#191414` | Grounding Typography / Background — rich off-black (warmer tone) |

## Supernal Gradient

| Name | Hex | Notes |
|---|---|---|
| Supernal Green | `#AFF005` | Primary gradient stop |
| Supernal Light Green | `#E8FFA7` | Transition / light stop |
| Soft Lavender/Blue | `#A7B6FF` | Transition color |

## Extended Palette

| Name | Hex | Character |
|---|---|---|
| Electric Blue | `#0062E6` | Vivid mid-blue, action secondary |
| Bright Orange | `#FF5511` | Warm, aggressive — close sibling of Tangerine |
| Vibrant Pink | `#FE86B1` | Lighter, softer pink accent |
| Golden Yellow | `#FFC107` | Warm amber-yellow |
| Sky Blue | `#A3D8F4` | Soft, airy blue |
| Pale Mint | `#B8E9D0` | Soft cool green — light accent |
| Deep Forest Green | `#007E33` | Rich, saturated dark green |
| Dark Indigo | `#1A1A4E` | Deep blue-black — structural dark |

## Neutrals

| Name | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Pure white |
| Cream/Off-White | `#FFF4E0` | Warm white — backgrounds, cards |
| Off-White | `#F6F0E6` | Slightly warmer off-white |
| Warm Gray | `#C3C3B6` | Muted warm gray — secondary text, borders |
| Dark Warm Gray | `#808064` | Deeper warm gray — subdued UI elements |
| Deep Charcoal | `#0D1B1E` | Near-black with cool undertone |
| Black (off-black) | `#191414` | Primary dark background |
| Black | `#000000` | Pure black |

## Usage Notes

- **Graph node fills:** the full palette is loaded in `src/lib/graph/graph-ontology-legend.ts`. Node color is assigned deterministically by hashing the entity kind key modulo the palette length.
- **Legibility on dark backgrounds:** prefer the core brand colors and extended palette entries over the near-black and near-white entries for filled shapes. Dark entries (`#000000`, `#191414`, `#0D1B1E`, `#1A1A4E`) and near-whites (`#FFFFFF`, `#F6F0E6`, `#FFF4E0`, `#E8FFA7`) will lose contrast against matching backgrounds.
- **Supernal Gradient:** intended as a CSS linear-gradient using the three gradient stops in order: `#AFF005` → `#A7B6FF` → `#E8FFA7` (or reversed).
