# Eigen — Design Specification

## Overview

**App Name:** Eigen  
**Tagline:** Capture. Structure. Remember.  
**Platform:** Mobile (iOS)  
**Purpose:** A minimal thought-capture app for quickly logging ideas and notes.

---

## Visual Identity

### Typography

| Element | Style |
|---|---|
| Logo / Wordmark | Serif display font, heavy weight, decorative/gothic style |
| Tagline | Sans-serif, regular weight, small size, muted color |
| Input placeholder | Sans-serif, regular weight, muted/gray |
| Button label | Sans-serif, medium weight, white |
| Keyboard shortcut hint | Sans-serif, small, muted gray |

### Color Palette

| Role | Value |
|---|---|
| Background | `#E8EDE5` — soft sage green |
| Card / Input background | `#FFFFFF` — white |
| Card shadow | Subtle offset box shadow, dark |
| Primary button | `#111111` — near black |
| Button text | `#FFFFFF` — white |
| Body / placeholder text | `#999999` — medium gray |
| Hint text | `#AAAAAA` — light gray |
| Bottom nav background | `#111111` — near black |
| Bottom nav icons | `#FFFFFF` — white |

---

## Layout & Structure

### Screen Sections (top to bottom)

1. **Header** — centered logo and tagline
2. **Capture Card** — main input area
3. **Empty State** — large open background area (content feed area)
4. **Bottom Navigation Bar** — fixed, pill-shaped

---

## Components

### Header

- Centered horizontally
- Logo: large decorative wordmark "EIGEN" in gothic/display serif
- Tagline: small sans-serif text below logo, muted color
- No border or background — floats on page background

### Capture Card

- Full-width card with white background
- Subtle drop shadow with slight bottom-right offset (stacked paper effect)
- Two sections divided by a thin horizontal rule:
  - **Top:** multiline text input with placeholder `"Enter your thought..."`
  - **Bottom:** keyboard shortcut hint on the left (`⌘ + Enter to capture`), primary button on the right (`Capture`)
- Border radius: none (sharp corners)
- Padding: ~16px horizontal

### Capture Button

- Background: `#111111`
- Text: `"Capture"`, white, medium weight
- Padding: `12px 24px`
- Border radius: ~4px (slightly rounded)
- Positioned bottom-right of the card

### Keyboard Shortcut Hint

- Text: `⌘ + Enter to capture`
- Color: muted gray
- Font size: small (~12px)
- Vertically centered in the bottom bar of the card

### Bottom Navigation Bar

- Fixed to bottom of screen
- Pill/capsule shape with `#111111` background
- Three items:
  - Left: network/graph icon (connections)
  - Center: `+` add button (prominent, white)
  - Right: sliders/filter icon (settings or filters)
- Icon color: white
- Full-width with horizontal padding, floating above screen edge

---

## Spacing & Sizing

| Element | Value |
|---|---|
| Header top padding | ~40px |
| Card horizontal margin | ~20px |
| Card input height | ~120px |
| Card bottom bar height | ~52px |
| Bottom nav height | ~56px |
| Bottom nav bottom margin | ~24px |

---

## Design Principles

- **Minimal** — no distractions, single focused action per screen
- **Paper-like** — card shadow gives a physical, tactile feel
- **Dark accents on light background** — high contrast without being harsh
- **Floating nav** — pill-shaped bottom bar feels modern and unobtrusive