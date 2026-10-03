# Design QA — Audience simulation

## Comparison target and evidence

- **Source truth:** C:/Users/eat07/Downloads/pitchy_audience_screens (4).html and its nine supplied screen captures in C:/Users/eat07/AppData/Local/Temp/.
- **Implementation:** /audience-simulation/operator/[code] in the existing campaign flow. No route or separate prototype page was added.
- **Full-view comparison:** C:/Users/eat07/AppData/Local/Temp/pitchy-audience-paired-final.png; each source screen is directly beside the corresponding browser capture.
- **Focused comparisons:** screens 03–09 are saved as C:/Users/eat07/AppData/Local/Temp/pitchy-audience-pair-03.png through pitchy-audience-pair-09.png.
- **Opening-screen comparison:** the supplied 941 × 1672 reference is paired with the updated Chrome capture at C:/Users/eat07/AppData/Local/Temp/audience-hero-side-by-side.png; the browser capture is C:/Users/eat07/AppData/Local/Temp/audience-hero-final-reference-size.png.
- **Browser captures:** C:/Users/eat07/AppData/Local/Temp/pitchy-audience-qa/ (01-hero.png through 09-result.png).
- **Viewport and density:** Chrome, 307 × 538 CSS px, deviceScaleFactor 1. The source files range from 286 × 538 to 307 × 538 pixels; smaller captures were centered on a 307 × 538 canvas without resampling. Source DPR was not recorded.

| Screen | Source pixels | Browser pixels | Captured state |
|---|---:|---:|---|
| 01 | 307 × 538 | 307 × 538 | Intro |
| 02 | 294 × 524 | 307 × 538 | Empty idea form |
| 03 | 302 × 533 | 307 × 538 | Search complete, 8 sources / 3 signals |
| 04 | 295 × 535 | 307 × 538 | Audience formed, ready to continue |
| 05 | 286 × 538 | 307 × 538 | Audience preview and editor |
| 06 | 304 × 533 | 307 × 538 | Interview complete, 12 / 12 |
| 07 | 299 × 545 | 307 × 538 | Reaction map |
| 08 | 301 × 543 | 307 × 538 | Findings |
| 09 | 297 × 542 | 307 × 538 | Result QR |

## Findings

No actionable P0, P1, or P2 visual findings remain.

Dynamic counts intentionally differ from the draft: the existing backend config caps the first run at 12 profiles (routers/audience_simulations.py, lines 252 and 798), whereas the mock shows 420 candidates and 100 interviewees. The interface displays actual response counts and source counts instead of reproducing those sample values.

## Required fidelity surfaces

- **Fonts and typography:** Inter is used from the site's local font files. Display text remains light, compact UI labels are smaller, and the nine-screen hierarchy and wrapping follow the draft. No truncation was visible in the final captures.
- **Spacing and layout:** The 9:16 screen, page margins, cards, maps, source categories, result cards, and QR composition are preserved. The bottom arrows / counter / autoplay panel was removed at the user's direction. Screen-to-screen progress now uses actions in the relevant page; no CTA overlaps the persistent footer.
- **Colors and tokens:** Near-black surfaces, muted gray text, cyan / violet / gold / mint marks, and the gradient progress accent follow the draft.
- **Image quality and assets:** Persona and response maps render current API data to canvas; the reaction points are selectable by pointer and keyboard. The production UI requests the QR image from the existing claim endpoint. The local browser fixture supplied a test QR and synthetic API data only.
- **Copy and content:** Russian copy matches the current task. Real source links open from the “Показать источники” disclosure. Synthetic-response disclaimers remain visible.

## Interactions and browser checks

Chrome completed the same route through all nine screens. The run checked short-idea validation, valid submission, source disclosure and continuation, audience continuation, group editor open / close, research start, 12 / 12 completion, map point selection by pointer and arrow keys, findings continuation, and QR creation. The prototype navigation panel and “Автопоказ” are absent. Browser console errors: 0.

The local visual run used a temporary API fixture on port 8000 because the backend was not running locally. This verifies the rendered journey and its interactions, not live Polza / search-provider or production API responses.

## Comparison history

1. The first comparison exposed a crowded sources screen and a preview action obscured by the demo controls. Source links were collapsed into a disclosure; the helper copy and preview spacing were tightened. Paired screens 03 and 05 were recaptured.
2. The user clarified that the rounded arrows / counter / autoplay panel must not ship. It was removed; source review, audience selection, findings, and result pages received in-flow actions. The nine screens were recaptured; the panel is absent.
3. That comparison found the new audience-build action clipped by the footer. The candidate-cloud height was reduced and its panel spacing tightened. Screen 04 was recaptured with the action fully visible.
4. The completed-interview disclaimer collided with the footer. The duplicate long text was replaced with a concise synthetic-response notice in the existing helper. Screen 06 was recaptured cleanly.
5. The map's pointer-only response selection was made keyboard-accessible with arrow keys and a visible focus ring. Pointer and keyboard selection both passed in the final browser run.
6. The opening screen uses the supplied text-free 9:16 scene with editable HTML copy over it. The art is fitted with its original proportions and narrow black side margins, including a taller-phone adjustment. Same-size Chrome comparisons at 941 × 1672 align the headline, accent line, mascot, and bubbles with the reference. The demo arrows / counter / autoplay strip visible in that reference remains excluded as requested.

## Follow-up polish

- The user-provided screens are mobile-sized. The final comparison used their supplied mobile viewport; a separate desktop visual review was outside this pass.
- The first-screen art was checked in Chrome at 307 × 538, 390 × 844, and 941 × 1672. It preserves the source 9:16 ratio without stretching. The logo and eyebrow do not overlap; the art loads without console or HTTP errors; the first screen continues to the existing idea form; the demo control panel remains absent.

final result: passed
