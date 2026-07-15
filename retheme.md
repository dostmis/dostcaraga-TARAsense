# Task: Re-theme TARAsense to an orange-primary / navy-secondary palette

## Context
This is the **TARAsense** Innovator Workspace — a React + TypeScript + Tailwind CSS + shadcn/ui app (sensory/market study management). Right now the UI reads as "white with orange accents" rather than a deliberate two-color system. I want a cohesive palette where **orange is the primary action color** and **navy blue is the structural secondary**.

Do NOT restructure layout, markup, spacing, or component logic. This is a **color pass only** — touch theme tokens and the className/variant color utilities, nothing else.

## Requirement
Apply this exact intent:
- **Orange = primary.** Reserve it for active/selected/interactive things: the active nav item, the selected radio option, badges, focus rings, primary buttons, and the help FAB. Don't spray it everywhere.
- **Navy = secondary/structure.** Use it for the sidebar, icon badges, and informational (non-action) surfaces like the "Location inherited from FIC" banner.
- The sidebar should become a **deep navy gradient** with the active item highlighted in orange (orange left-accent bar + orange-tinted background + orange icon).
- The currently-blue selected radio (e.g. "Same City / Municipality") becomes **orange** to match the primary action color.
- The info/notice banner becomes a **navy tint** so it reads as secondary and doesn't fight the orange selection above it.

## Architecture

### 1. Discover before editing
First inspect the repo and report what you find before changing anything:
- The Tailwind config (`tailwind.config.{ts,js,cjs}`) — how is `theme.extend.colors` set up?
- The global stylesheet (`globals.css` / `index.css` / `app.css`) — locate the shadcn `:root` and `.dark` CSS variable blocks.
- Whether colors are referenced as shadcn semantic tokens (`bg-primary`, `text-secondary`, `ring`) or as raw Tailwind colors (`bg-orange-500`, `bg-blue-600`).
- The components for: sidebar/nav, the Target Participants radio cards, the info banner, badges, and the FAB.

Then apply changes through whichever system the repo already uses. Prefer editing the central tokens over per-component hardcoded hexes; replace hardcoded color classes with semantic tokens where it's low-risk.

### 2. Token values
Add/update these. Both formats given — use **HSL** for shadcn CSS variables, **hex** for `tailwind.config` color extensions.

| Role | Hex | HSL (shadcn) |
|------|-----|--------------|
| `primary` (orange) | `#F97316` | `24 95% 53%` |
| primary hover/active | `#E85D04` | `23 97% 46%` |
| primary text-on-white (small text only) | `#C2540B` | `24 89% 40%` |
| orange tint surface | `#FFF4EC` | `25 100% 96%` |
| `secondary` (navy) | `#14264A` | `220 58% 18%` |
| navy deepest (sidebar bottom) | `#0E1E3D` | `220 63% 15%` |
| navy mid (icon badges) | `#1C3560` | `218 55% 24%` |
| navy tint surface (info banner bg) | `#F1F5FB` | `215 55% 96%` |
| foreground / ink | `#1B2741` | `221 23% 18%` |
| border | `#E6E8EC` | `220 14% 91%` |

### 3. shadcn semantic mapping
In the `:root` block map at least:
- `--primary: 24 95% 53%;` and `--primary-foreground: 0 0% 100%;`
- `--secondary: 220 58% 18%;` and `--secondary-foreground: 0 0% 100%;`
- `--ring: 24 95% 53%;` (orange focus ring)
- `--accent` / `--accent-foreground` for the orange-tint hover/selected surface
- keep `--background`, `--card` white/near-white; set `--foreground: 221 23% 18%;`

If a `.dark` theme exists, mirror the mapping (navy surfaces, orange stays the accent) but flag it for me rather than guessing aggressively.

### 4. Component-level application
- **Sidebar:** `background: linear-gradient(185deg, #0E1E3D, #0A1730)`, white text, muted blue-gray (`#C2CADC`) for inactive items.
- **Active nav item:** orange-tinted background, white text, a 4px orange left-accent bar, orange icon.
- **Badges (the `0` / `3` pills):** solid orange, white text.
- **Selected radio card:** orange border, `#FFF4EC` background, orange filled radio dot, and the title in `#C2540B` (orange-700) — see accessibility note.
- **Info banner:** `#F1F5FB` background, navy icon circle, navy text.
- **Inputs/selects:** keep white; focus state = orange border + `0 0 0 3px rgba(249,115,22,0.18)` ring.
- **FAB / help button:** orange gradient.
- **Logo:** "TARA" in foreground ink, "sense" in orange (likely already the case — verify).

## Product (acceptance criteria)
- [ ] No layout, spacing, copy, or logic changes — diff is color/theme only.
- [ ] App builds and typechecks clean; no leftover unused color tokens or broken class names.
- [ ] Orange appears only on active/interactive elements; navy carries the sidebar + informational surfaces.
- [ ] **Accessibility:** `#F97316` on white is only ~2.9:1, so never use plain orange for small/body text on white. Use it for fills, borders, and large/bold accents; use `#C2540B` (orange-700) for any small orange text. Verify focus rings remain visible.
- [ ] Dark mode (if present) handled or explicitly flagged.
- [ ] Show me the final diff grouped by file, and a one-line summary of which files changed.

Work in small, reviewable steps. Start by reporting the discovery findings from step 1 and your planned file changes **before** editing.
