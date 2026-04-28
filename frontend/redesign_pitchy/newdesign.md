---
name: Pitchy.pro Core
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353434'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c9c6c5'
  on-secondary: '#313030'
  secondary-container: '#4a4949'
  on-secondary-container: '#bab8b7'
  tertiary: '#ffffff'
  on-tertiary: '#2f3131'
  tertiary-container: '#e2e2e2'
  on-tertiary-container: '#636565'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c9c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474646'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#141313'
  on-background: '#e5e2e1'
  surface-variant: '#353434'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  h1:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  mono-label:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  code:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1440px
  gutter: 16px
---

## Brand & Style

This design system is built on the philosophy of **Technical Absolute Minimalism**. It targets a high-end engineering audience that values density, precision, and performance over decorative flair. The aesthetic is "Hardcore DevTools"—an environment where the interface recedes to let the data and logic take center stage.

The style is a hybrid of **Minimalism** and **Glassmorphism**, executed with a surgical, monochrome precision. It evokes an emotional response of "industrial-grade reliability" and "uncompromised focus." There is zero visual clutter: no illustrations, no organic shapes, and no human photography. The interface should feel like a high-end terminal or a proprietary satellite control system—cold, stark, and powerful.

## Colors

The palette is strictly monochromatic. The foundation is an abyss-black (`#0A0A0A`), providing a high-contrast stage for stark white elements.

- **Primary:** Pure White (`#FFFFFF`). Reserved for critical actions, primary typography, and active states.
- **Background:** Deep Black (`#0A0A0A`). The default canvas for the entire application.
- **Surface Tiering:** Use `#111111` and `#161616` for nested containers and cards to create subtle depth without breaking the dark immersion.
- **Accents:** No vibrant colors are permitted. Status indicators (success, error, warning) are handled through iconography and grayscale intensity (e.g., bright white for active, dim gray for inactive) rather than hue.
- **Flashlight Effect:** Hover states on interactive cards should utilize a radial gradient `rgba(255, 255, 255, 0.03)` that follows the cursor, mimicking a faint light source in a dark room.

## Typography

This design system utilizes a combination of **Inter** for structural clarity and **Space Grotesk** for technical data and labels. 

- **Inter** is the workhorse for body copy and headlines, providing a neutral, "Geist-like" sans-serif feel that disappears into the UI.
- **Space Grotesk** is used for all labels, metadata, and buttons to reinforce the DevTools/Engineering aesthetic. Its geometric quirks provide the "Premium Tech" character.
- **Letter Spacing:** Headlines use negative tracking for a tighter, more "engineered" look. Labels use positive tracking and uppercase for maximum legibility at small sizes.

## Layout & Spacing

The layout follows a **Rigid Grid System** based on a 4px baseline. Precision is paramount; elements must align to the pixel. 

- **The 12-Column Grid:** Use a standard 12-column grid for page layouts with fixed 16px gutters. 
- **Density:** Information density should be high. Use `16px` (md) for standard padding and `8px` (sm) for internal component spacing.
- **Negative Space:** Use large blocks of `#0A0A0A` (48px+) to separate major functional sections, ensuring the UI feels expansive and premium rather than cramped.
- **Borders:** All sections and sidebar dividers must use a 1px hairline stroke with `rgba(255, 255, 255, 0.08)`.

## Elevation & Depth

Depth is achieved through **Tonal Layering** and **Hairline Outlines** rather than traditional shadows.

- **Stacking:** Surface level 0 is `#0A0A0A`. Level 1 (Cards/Modals) is `#111111`. Level 2 (Popovers/Tooltips) is `#161616`.
- **Borders:** Every elevated element must have a 1px border. For modals, the border opacity can increase to `0.15` to distinguish it from the background.
- **Glassmorphism:** Use `backdrop-filter: blur(12px)` on navigation bars and floating menus to create a sense of verticality.
- **Shadows:** Avoid soft, large ambient shadows. If a shadow is required for legibility on overlapping elements, use a sharp, 1px black stroke or a very tight, 4px blur shadow with 0.5 opacity.

## Shapes

The shape language is **Soft-Geometric**. Corners are slightly rounded to prevent the UI from feeling overly aggressive or "brutalist," but kept tight enough to maintain a professional, hardware-inspired look.

- **Standard Radius:** 4px (`0.25rem`) for buttons, inputs, and small cards.
- **Large Radius:** 8px (`0.5rem`) for main containers and modals.
- **Interactive States:** Under no circumstances should shapes become "pill" or "circular" unless they are icons or avatars (which should be replaced by initials or monograms in this design system).

## Components

### Buttons
- **Primary:** Solid White background, Black text. No border. On hover, slight opacity reduction to `0.9`.
- **Secondary:** Transparent background, 1px hairline white border (0.1 opacity), White text. On hover, background becomes `rgba(255,255,255,0.05)`.
- **Tertiary/Ghost:** No background or border. Text is `#888888`. On hover, text becomes White.

### Input Fields
- **Default:** Background `#111111`, 1px border (0.08 opacity). Text is White.
- **Focus:** Border opacity increases to `0.4`. No "glow" effect, just a crisp border change.
- **Placeholder:** Hex `#444444` in Space Grotesk.

### Chips / Tags
- Small, 12px Mono-label text. 
- Background `rgba(255,255,255,0.05)`, 1px border. No rounded-full; use 4px radius.

### Cards
- Background `#111111`. 
- Incorporate a "Flashlight" hover effect: a radial gradient tracking the mouse to subtly illuminate the hairline border.

### Lists & Data Tables
- Header rows use `#444444` uppercase Space Grotesk.
- Rows separated by 1px hairline dividers. 
- Hover state for rows: `background: rgba(255, 255, 255, 0.02)`.

### Checkboxes & Radios
- Strict squares (checkbox) and circles (radio). 
- Unchecked: 1px border. Checked: Solid White with a Black tick/dot.