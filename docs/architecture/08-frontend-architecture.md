# Phase 8 — Frontend Architecture

**Status:** Draft v1 for review
**Depends on:** [Phase 7 API Design](./07-api-design.md), Phase 1 §11 (tech stack)

How the Next.js app is put together — rendering strategy, multi-tenant
routing/theming, state management, forms, and the constraints that come
from the target market (variable mobile networks, bilingual UI). Directory-
level layout is Phase 10; this phase is the concepts that directory
structure has to express.

---

## 1. Rendering strategy

**Next.js App Router, mostly server components, client components only
where interactivity requires it.** Reasoning specific to this product:

- Dashboards and record views (student list, invoice list, report card) are
  fundamentally "fetch data, render it" — server components do this with
  less JS shipped to the browser, which matters directly for the "average
  Pakistani mobile network" constraint from Phase 1 §11.
- Interactive surfaces genuinely need the client: attendance grid entry
  (Phase 3 B2), marks grid entry (B4), the AI draft-and-approve editing flow
  (B5) — these become client components, kept as small and leaf-level as
  possible so the surrounding page shell stays server-rendered.
- Server actions (Next.js's mutation mechanism) are used for simple form
  submissions where a full client-side fetch layer would be overhead (e.g.
  updating a setting); the client-side data-fetching library (§4) is used
  where a page needs live re-fetching, optimistic updates, or polling (e.g.
  the signup provisioning-status poll from Phase 7 §4).

## 2. Multi-tenant routing & theming

This is the part of the frontend that's genuinely unusual compared to a
single-tenant app, so it gets stated precisely:

- **Tenant resolution happens in Next.js middleware**, reading the request's
  hostname (subdomain or custom domain) and attaching the resolved tenant's
  ID/branding/API base URL to the request context before any page renders
  — mirroring the Tenant API's own resolution rule from Phase 7 §1. The
  frontend never asks "which tenant am I" from a client-side value; it's
  established once, server-side, per request.
- **Branding is applied at the layout level**, not per-page: a root layout
  reads the resolved tenant's logo/colors and injects them as CSS custom
  properties (see Phase 11 for the token system these plug into), so every
  page under that layout is automatically on-brand without per-page work.
- **The marketing/signup site and the Super Admin console are separate
  route trees from the tenant app**, not tenant-branded, since they exist
  outside any single school's context — this maps directly to the
  Platform API vs. Tenant API split from Phase 7 §1.
- A request that arrives on an unrecognized subdomain gets a clear
  "no such school" page, not a generic 404 or, worse, a fallback to some
  default tenant's data.

## 3. Portal structure

Four portals (Admin, Teacher, Parent, Student — per Phase 2 §E), plus Auth
and the tenant-external Marketing/Signup and Super Admin trees. Each portal
is a route group with:

- Its own navigation shell (a Teacher doesn't see Finance in their nav; a
  Parent doesn't see a "mark attendance" screen) — enforced by both route
  grouping (so the wrong nav literally isn't in the bundle for that portal)
  and the permission middleware from Phase 7 §3 (so a stale client can't
  render a page it has no API access to anyway).
- A shared component layer underneath (Phase 12) — the same underlying
  "student record card" component appears in Admin and Teacher portals with
  different action buttons, not two copies of similar-but-drifting UI.

Role → portal is mostly 1:1 (Phase 1 §4 personas), except: School Owner and
Principal both use the Admin portal (same screens, permission-gated
differences, not a fifth portal); Admin Staff and HR likewise share the
Admin portal shell.

## 4. State management

Two clearly separated kinds of state, handled by different tools —
conflating them is a common source of bugs in apps this data-heavy:

| Kind | Examples | Tool |
|---|---|---|
| **Server state** (anything that lives in the database) | Student list, invoices, attendance | A client-side data-fetching/caching library (e.g. TanStack Query) layered on top of the Tenant API from Phase 7 — handles caching, re-fetching, optimistic updates (e.g. marking attendance feels instant, reconciles with the server response) |
| **UI state** (exists only in the browser, never persisted) | "which tab is active," "is this modal open," draft form values before submit | Local component state / a lightweight store (e.g. Zustand) — never Redux-scale ceremony for a state layer this thin |

No global client-side store duplicates server data "for speed" — that's
exactly the kind of premature optimization that produces stale-data bugs
(a parent seeing an old invoice balance because a client cache wasn't
invalidated). The data-fetching library's cache, keyed by API resource, is
the single source of truth for server state on the client.

## 5. Forms & validation

- **One shared validation schema per resource, used on both client and
  server.** The same schema (e.g. a Zod schema for "create student") drives
  client-side inline validation (instant feedback) and is re-validated
  server-side on the actual API call (Phase 7) — never trust client
  validation alone, per the security posture from Phase 1.
- **Multi-step forms** (admission application, exam definition) preserve
  progress locally (so a lost connection mid-form doesn't lose data) but
  only commit to the server on explicit submit, matching the "draft, then
  submit" pattern already established for marks entry (Phase 3 B4) and AI
  content (E1).
- **Grid-entry forms** (attendance, marks) are a distinct pattern from
  single-record forms — optimized for keyboard/tap speed (tab between
  cells, bulk-default values) since Phase 3 B2/B4 explicitly call out
  "under a minute" / "one sitting" as the usability bar.

## 6. Internationalization (bilingual Urdu/English)

Per Phase 1 §10, this is designed in now, not retrofitted:

- All user-facing strings route through an i18n layer from the first screen
  built, even though V1 UI may ship English-first — adding Urdu strings
  later should be a translation task, not a code-restructuring task.
- Urdu is right-to-left-adjacent in usage in Pakistan but commonly rendered
  left-to-right in mixed Urdu/English UI (unlike Arabic); layout components
  are still built with logical (start/end) rather than physical (left/
  right) CSS properties so a true RTL mode isn't a rewrite if ever needed.
- Number/date/currency formatting goes through locale-aware formatting
  utilities everywhere (no hand-built "Rs. " + number string concatenation
  scattered across components), since fee amounts and dates are on nearly
  every screen in this app.

## 7. Performance for variable mobile networks

A real design constraint, not boilerplate:

- Route-level code splitting per portal (a Parent's bundle never loads
  Admin Staff's fee-structure editor code).
- Images (student photos, logos) served through an optimized/responsive
  pipeline (Next.js Image or equivalent), never full-resolution originals
  on a list screen with 40 thumbnails.
- Lists (student rosters, invoice lists) paginate or virtualize — matches
  the cursor-pagination API design from Phase 7, not a client that fetches
  "all students" and filters in the browser.
- Critical flows (marking attendance, viewing today's homework) are the
  ones profiled and budgeted first — a slow admin report screen is an
  annoyance, a slow attendance-marking screen costs a teacher class time
  every single day.

## 8. Auth on the frontend

- Session token handled via httpOnly cookie (not `localStorage`) to reduce
  XSS exposure, checked in middleware alongside tenant resolution (§2) —
  a request that's on the right tenant but not authenticated redirects to
  that tenant's login, never a generic one.
- Role-based redirect after login: a Teacher lands in the Teacher portal
  home, a Parent in the Parent portal home — no post-login "choose your
  portal" step for the common case of one role per user.
- Session expiry is handled gracefully mid-form (per §5, drafts preserved
  locally) rather than silently discarding in-progress work.

## 9. Error & empty states

- A failed API call surfaces the `error.message` from Phase 7's error
  shape directly where it's actionable ("Payment declined — try another
  method") and a generic friendly fallback where it isn't (unexpected
  server error) — never a raw stack trace or JSON blob in the UI.
- Empty states are written specifically per screen (a Teacher with no
  homework posted yet sees "Post your first assignment," not a bare blank
  table) — small detail, consistently matters for the "easy for
  non-technical users" bar from Phase 1's UI philosophy.

## Next step

**Phase 9 — Backend Architecture** designs the service that actually
implements the Phase 7 API — including the database-per-tenant connection
routing that this frontend's tenant resolution (§2) depends on existing
correctly on the other side.
