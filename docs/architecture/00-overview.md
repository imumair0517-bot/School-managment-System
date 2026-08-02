# School SaaS OS — Architecture Program

This `docs/architecture/` folder is the single source of truth for the platform's
architecture. It is built **phase by phase**, per the program below. No implementation
code is written until the relevant phase (and the module design that follows it) is
reviewed and approved.

## Phase Index

| # | Phase | Status |
|---|-------|--------|
| 1 | [Product Requirements Document](./01-prd.md) | ✅ Draft for review |
| 2 | [Feature Breakdown](./02-feature-breakdown.md) | ✅ Draft for review |
| 3 | [User Stories](./03-user-stories.md) | ✅ Draft for review |
| 4 | [User Flows](./04-user-flows.md) | ✅ Draft for review |
| 5 | [Database Design](./05-database-design.md) | ✅ Draft for review |
| 6 | [ER Diagram](./06-er-diagram.md) | ✅ Draft for review |
| 7 | [API Design](./07-api-design.md) | ✅ Draft for review |
| 8 | [Frontend Architecture](./08-frontend-architecture.md) | ✅ Draft for review |
| 9 | [Backend Architecture](./09-backend-architecture.md) | ✅ Draft for review |
| 10 | [Folder Structure](./10-folder-structure.md) | ✅ Draft for review |
| 11 | [UI Design System](./11-ui-design-system.md) | ✅ Draft for review |
| 12 | [Component Library](./12-component-library.md) | ✅ Draft for review |
| 13 | [Development Roadmap](./13-development-roadmap.md) | ✅ Draft for review |
| 14 | Testing Strategy | ⏳ Not started |
| 15 | Deployment Strategy | ⏳ Not started |
| 16 | Documentation Plan | ⏳ Not started |

## Rules of engagement

1. **Architecture before code.** Nothing under `apps/`, `packages/`, or `services/` gets
   written until the phases feeding it are approved.
2. **One phase at a time.** Each phase is a separate, reviewable deliverable.
3. **Every module**, once we reach implementation, is designed with: purpose, features,
   database tables, relationships, API endpoints, business rules, validation rules,
   permissions, UI screens, reusable components, testing checklist, edge cases, and
   acceptance criteria — before any code is generated for it.
4. **Decisions are justified.** Every non-trivial architectural choice states the
   alternatives considered and why the recommendation wins for this product, at this
   stage, for this market.
