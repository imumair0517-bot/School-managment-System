# Phase 11 — UI Design System

**Status:** Draft v1 for review
**Depends on:** Phase 1 UI Philosophy, [Phase 8 Frontend Architecture](./08-frontend-architecture.md)

The visual language `packages/ui` (Phase 10 §2) implements: color, type,
spacing, and the tenant-branding mechanism. Tokens, not components — Phase
12 is the component inventory built on top of this.

---

## 1. Design principles (specific to this product, not generic)

Stated as rules a real screen gets checked against, not slogans:

1. **A non-technical school-office user is the default user, not the
   exception.** Every screen is judged against "would Admin Staff at a
   400-student school understand this without training," not against what
   a developer finds intuitive. This is the single biggest way this system
   differs from a Linear/Stripe-style reference product built for
   technical users.
2. **State is shown, not implied.** An invoice is visibly overdue, a
   report card is visibly a draft, an AI-generated remark is visibly
   unapproved — through color/shape/label together, per §6, never color
   alone (accessibility, and because color-only status is easy to miss on
   a low-quality phone screen).
3. **Dense where density earns its keep, spacious everywhere else.**
   Grid-entry screens (attendance, marks — Phase 3 B2/B4) are information-
   dense by necessity, built for speed. Everything else — dashboards,
   settings, record detail pages — gets generous whitespace. Both are
   "clean," density and spaciousness are matched to the task, not applied
   uniformly.
4. **The product's own identity stays quiet; the school's brand is what a
   parent/teacher actually sees.** Tenant branding (§7) is a first-class
   part of this system, not a logo bolted onto an otherwise-generic
   template.

---

## 2. Color

### 2.1 Neutrals
A warm-leaning neutral scale (not pure grey) — pairs cleanly with the
single product accent below without competing with a school's own brand
color once applied (§7).

| Token | Light | Dark (built into tokens now, shipped later — see §8) |
|---|---|---|
| `--bg` | `#FAFAF9` | `#121613` |
| `--surface` | `#FFFFFF` | `#181D19` |
| `--border` | `#E4E2DB` | `#2A302B` |
| `--ink` (primary text) | `#1B211D` | `#ECEFEA` |
| `--ink-muted` (secondary text) | `#6E756F` | `#98A199` |

### 2.2 Product accent
| Token | Value | Use |
|---|---|---|
| `--accent` | `#1F6F5C` (deep teal-green) | Primary actions, active nav, links — **only where a tenant hasn't overridden it** (§7) |
| `--accent-soft` | `#E4F0EC` | Backgrounds for accent-colored chips/highlights |

### 2.3 Semantic status colors — separate from the accent, always
This is a data-heavy product (invoice status, attendance status, admission
pipeline stage, tenant subscription status) — semantic color is its own
system per Principle 2 above, and must stay legible regardless of what a
tenant's brand accent is set to:

| Meaning | Token | Light | Used for |
|---|---|---|---|
| Success / positive | `--success` | `#2E7D4F` | Paid, Present, Approved, Active |
| Warning / attention | `--warning` | `#9C6F22` | Overdue-soon, Late, Draft pending review |
| Critical / negative | `--critical` | `#B23B2E` | Overdue, Absent-unexplained, Failed payment, Suspended |
| Informational | `--info` | `#3B6FA0` | Waitlisted, Provisioning, neutral in-progress states |

Every status token pairs a color **and** a fixed label/icon per state
(§6) — never rely on the color swatch alone to carry meaning.

---

## 3. Typography

| Role | Typeface | Rationale |
|---|---|---|
| UI text (default) | **Inter** (or equivalent grotesk — e.g. system-ui as fallback) | Purpose-built for small-size UI legibility, which matters directly for dense grid-entry screens (Principle 3) and lower-end phone displays; also the typeface family the product's own reference points (Linear, Stripe, Vercel) converge on for exactly this reason, not chosen by default |
| Numerals / tabular data | Inter with `font-variant-numeric: tabular-nums` | Fee amounts, marks, dates align in columns — required wherever digits are compared visually (invoice tables, marks grids) |
| Monospace (rare — IDs, reference numbers) | ui-monospace / SF Mono stack | Receipt numbers, API reference IDs in admin/support views only |

**Type scale** (rem, 1rem = 16px base):

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.75rem | Meta labels, timestamps |
| `--text-sm` | 0.875rem | Secondary UI text, table cells |
| `--text-base` | 1rem | Body default |
| `--text-lg` | 1.125rem | Section headers within a page |
| `--text-xl` | 1.375rem | Page titles |
| `--text-2xl` | 1.75rem | Dashboard headline numbers (e.g. "Rs. 240,000 collected") |

**Urdu script note:** the i18n layer (Phase 8 §6) is built in from V1, but
V1's *written* UI ships English-first (matches how most target private
schools already run their administrative paperwork). When Urdu UI strings
are added, the type stack needs a Nastaliq/Naskh-capable Urdu web font
selected and tested for the same small-size legibility bar as Inter — noted
here as a known future task, not solved in this pass.

---

## 4. Spacing & layout

- **4px base unit**, scale: 4/8/12/16/24/32/48/64 — matches Tailwind's
  default spacing scale directly (Phase 1 §11 stack choice), so tokens and
  utility classes stay in lockstep rather than fighting each other.
- **Content max-width ~72rem (1152px)** for dashboard/table-heavy screens,
  narrower (~40rem) for single-record forms and settings — wide tables get
  their own horizontal scroll container (never the page body scrolling
  sideways), narrow forms stay readable and don't stretch input fields
  across a whole ultrawide monitor.
- **8px corner radius** as the default for cards/inputs/buttons — soft
  enough to feel modern, restrained enough to stay "professional," per
  Phase 1's UI philosophy, not the more rounded/playful radius a consumer
  app might use.

## 5. Elevation

Two levels only — this product doesn't need a complex shadow system:

| Token | Use |
|---|---|
| `--shadow-flat` (border only, no shadow) | Default cards, table rows |
| `--shadow-raised` (subtle shadow) | Modals, dropdowns, anything temporarily overlaying page content |

Restraint here is deliberate — heavy shadows/gradients read as dated for
this reference class of product (Linear/Stripe/Notion all use minimal
elevation), and per the "no clutter" principle from Phase 1.

## 6. Status language (icon + label + color, always together)

Applies everywhere a record has state — invoices, attendance, admission
pipeline, AI content, tenant lifecycle:

| Pattern | Example |
|---|---|
| A colored **pill** with a short label, never color alone | "Overdue" (critical, red-toned) next to "Paid" (success, green-toned) on the same invoice list |
| A **draft indicator** distinct from status colors | AI-generated, unapproved content (Phase 3 E1) gets its own visual treatment (e.g. a dashed border or "Draft — review to publish" label) — not just a status pill, since this state specifically needs to prompt an action, not just inform |
| **Icons reinforce, never replace, the label** | A checkmark icon next to "Present," not a checkmark alone |

## 7. Tenant branding — how a school's identity plugs in

Per Phase 8 §2, a tenant's `branding_logo_url` and `branding_primary_color`
(Phase 5 §2.1) are injected as CSS custom properties at the layout level,
overriding `--accent` (§2.2) for that tenant's entire app instance. Rules
that keep this safe:

- **Semantic status colors (§2.3) are never overridden by tenant branding**
  — a school choosing a red brand color must not make "Overdue" and
  "brand-colored button" visually indistinguishable.
- **Contrast is validated at branding-setup time**, not left to chance: if
  a school picks a primary color that fails WCAG AA contrast against
  `--bg`/`--surface`, the branding UI (Settings, Phase 7 §5.9) warns and
  suggests a corrected shade rather than silently shipping an
  illegible button.
- **Neutrals (§2.1), type (§3), and spacing (§4) never change per tenant**
  — only the accent and logo do. This is what keeps the product feeling
  like one consistent system across a thousand different schools' colors,
  rather than a thousand different-looking apps.

## 8. Dark mode — scoped decision

**V1 ships light mode only.** The target primary users (school office
staff, teachers on shared computers) don't have the dark-mode expectation
that a developer-tool audience does, and building/QA-ing two themes per
tenant-branding-override combination (§7) is real added scope for a solo/
AI-assisted build (Phase 1 decision #6) that doesn't pay for itself in V1.
**However:** every token above is a semantic variable, never a hardcoded
value inside a component (Phase 12 builds components against `--bg`,
`--ink`, etc., not literal hex codes) — specifically so dark mode is a
token-file addition later, not a component rewrite, if/when it's
prioritized.

## 9. Accessibility baseline

- Text/background combinations meet **WCAG AA** contrast at minimum,
  checked against both the base palette (§2.1–2.3) and tenant-overridden
  accents (§7).
- All interactive elements have a **visible keyboard focus state** — not
  optional, given Admin Staff/HR workflows are frequently keyboard-driven
  data entry (Phase 3 B4's "grid entry" pattern especially).
- **Touch targets ≥ 44px** on mobile viewports — the Parent portal in
  particular is expected to be used on phones far more than desktops.

## Next step

**Phase 12 — Component Library** builds the actual component inventory
(buttons, tables, status pills, the grid-entry pattern, the AI-draft
review UI) on top of these tokens, per portal.
