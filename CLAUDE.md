# CLAUDE.md

This file is for AI coding agents working in this repository. Read this first, then only open the files needed for the current task.

## 30-Second Summary

- Chinese food logging app built with `Next.js 15`, `React 19`, `TypeScript`, `Tailwind`, and `PostgreSQL`
- Core rule: database nutrition lookup first, Gemini fallback second
- The product uses a full 23-field nutrition profile, not just calories/macros
- Anonymous users work locally first; authenticated users sync to PostgreSQL and can migrate local drafts after login
- Runtime depends on refreshed materialized views; empty publish layers should fail loudly

## Read Order

1. Read this file
2. Read [package.json](./package.json)
3. Read [README.md](./README.md) only if product behavior or setup is unclear
4. Use the task router below instead of scanning the whole repo

## Ignore By Default

- `node_modules/`
- `.next/`
- `tsconfig.tsbuildinfo`
- `.env.local`
- `.DS_Store`
- `package-lock.json` unless debugging dependencies
- `modal/` unless the task is specifically about Modal or alternate inference infrastructure

## Stack And Commands

- Stack: `Next.js App Router`, `React 19`, `TypeScript`, `Tailwind`, `Radix UI`, `Recharts`, `pg`, `Gemini`
- Dev server: `npm run dev` on port `9002`
- Build: `npm run build`
- Start: `npm run start`
- Type check: `npm run typecheck`
- Full tests: `npm test`
- Targeted test example: `npx tsx --test src/lib/nutrition-db.test.ts`
- Runtime DB report: `npm run report:runtime-db`

## Environment And Hard Dependencies

- DB is required for meaningful runtime behavior
- Primary local DB config: `DATABASE_URL=postgresql://localhost:5432/foodetl_local`
- `PG*` variables can be used instead of `DATABASE_URL`
- Gemini fallback requires `GEMINI_API_KEY`
- Magic-link auth requires `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM`
- Treat `.env.local` as sensitive; do not paste secrets into prompts

## Source Of Truth

Use these in order:

1. Current code in `src/` and `db/`
2. [README.md](./README.md)
3. [docs/deployment.md](./docs/deployment.md) for deployment and ops

Treat [docs/blueprint.md](./docs/blueprint.md) as historical only. It reflects an older macro-focused concept, not the authoritative spec for the current 23-nutrient product.

## Architecture Map

- `src/app/`: App Router pages and server actions
- `src/app/page.tsx`: main UI/state coordinator
- `src/app/auth/callback/route.ts`: magic-link callback
- `src/components/macro-calculator/`: product UI
- `src/components/ui/`: shared UI primitives
- `src/app/actions/`: server actions for parsing, auth, logs
- `src/ai/flows/`: AI orchestration
- `src/lib/`: business logic, DB, parsing, auth, telemetry
- `db/`: migrations and materialized view refresh
- `deploy/systemd/`: daily refresh timer/service

## Task Router

If the task is about UI or page behavior:

- Read `src/app/page.tsx`
- Read `src/components/macro-calculator/types.ts`
- Read only the specific component under `src/components/macro-calculator/`
- Open `src/app/actions/logs.ts` only if persistence is involved

If the task is about food parsing or nutrition results:

- Read `src/ai/flows/parse-food-description-flow.ts`
- Then read only as needed:
  - `src/lib/direct-food-parser.ts`
  - `src/lib/food-text.ts`
  - `src/lib/portion-reference.ts`
  - `src/lib/nutrition-db.ts`
  - `src/lib/nutrition-profile.ts`
  - `src/lib/gemini.ts`
  - `src/lib/validation.ts`

If the task is about logs, history, export, or migration:

- Read `src/app/actions/logs.ts`
- Read `src/lib/food-log-db.ts`
- Read `src/lib/log-date.ts`

If the task is about auth or sessions:

- Read `src/app/actions/auth.ts`
- Read `src/app/auth/callback/route.ts`
- Read `src/lib/auth.ts`
- Read `src/lib/smtp.ts` only if email sending matters

If the task is about DB connectivity or query behavior:

- Read `src/lib/db.ts`
- Read `src/lib/nutrition-db.ts`
- Read relevant files under `db/migrations/`
- Read `db/refresh_materialized_views.sh` if runtime data freshness is involved

If the task is about deployment or production issues:

- Read `README.md`
- Read `docs/deployment.md`
- Read `deploy/systemd/*`
- Read `next.config.ts`

## Key Entry Points

- Parse action: `src/app/actions/food.ts`
- Parse orchestrator: `src/ai/flows/parse-food-description-flow.ts`
- Log actions: `src/app/actions/logs.ts`
- Auth actions: `src/app/actions/auth.ts`
- DB pool: `src/lib/db.ts`
- Nutrition lookup: `src/lib/nutrition-db.ts`
- Gemini client/prompting: `src/lib/gemini.ts`

## Non-Negotiable Product Rules

- Keep the "database first, AI fallback second" strategy; do not make Gemini the default path for simple inputs
- Preserve the full 23-nutrient profile shape across parsing, storage, and rendering
- Frontend weight edits should recompute locally when possible; avoid extra model calls
- Anonymous and authenticated flows are intentionally different; preserve draft migration after login
- Runtime checks for empty publish layers are intentional and should not be removed
- Safe fuzzy matching matters; do not reintroduce unsafe broad substring matching like raw `ILIKE '%term%'`

## Important Hotspots

- `src/app/page.tsx`: main stateful coordinator; easy place to introduce regressions
- `src/lib/nutrition-db.ts`: exact/fuzzy lookup, thresholds, runtime cache
- `src/ai/flows/parse-food-description-flow.ts`: direct parsing, grams estimation, validation flags, AI fallback

## Testing Guidance

Existing tests are concentrated in `src/lib/`:

- `src/lib/food-text.test.ts`
- `src/lib/log-date.test.ts`
- `src/lib/nutrition-db.test.ts`
- `src/lib/portion-reference.test.ts`
- `src/lib/validation.test.ts`

When changing parsing, lookup, or validation logic, prefer a targeted `tsx --test` run before the full suite.

## DB Workflow Notes

After DB schema or publish-layer changes, expect to run:

```bash
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
bash ./db/refresh_materialized_views.sh
```

If startup fails because nutrition materialized views are empty, refresh likely did not complete successfully.

## Practical Editing Guidance

- Default user-facing language is Chinese
- Prefer surgical changes over broad refactors unless restructuring is the task
- If touching parsing or nutrition logic, preserve validation flags and source metadata unless there is a strong reason to change them
- If touching auth or logs, verify whether the path is anonymous mode, authenticated mode, or migration between them
- If only changing presentation, avoid pulling AI/DB files into context

## Compact Memory To Retain

- Next.js food logging app, Chinese UX, PostgreSQL-backed
- 23-field nutrition profile is a core invariant
- Database lookup is primary; Gemini is fallback only
- `src/app/page.tsx` is the UI/state hotspot
- `src/lib/nutrition-db.ts` and `src/ai/flows/parse-food-description-flow.ts` are the backend hotspots
- Materialized view refresh is required for valid runtime data
- Authenticated users sync to DB; anonymous users work locally first
