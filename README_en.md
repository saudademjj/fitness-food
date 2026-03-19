<div align="center">
  English | <a href="./README.md">简体中文</a>
</div>

# Fitness-Food -- Diet Management & AI Nutrition Analysis System

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/Gemini_AI-Enabled-brightgreen?style=flat-square)

Fitness-Food is a diet management system that combines AI natural-language parsing, PostgreSQL-backed nutrition lookup, and interactive nutrition tracking. The runtime prioritizes direct database matches for simple food descriptions, invokes Gemini only when natural-language parsing is genuinely needed, and supports runtime composite-dish aggregation with full 23-field nutrition output.

## System Highlights

- Simple single-food descriptions hit PostgreSQL first, avoiding unnecessary model calls
- Gemini is reserved for complex descriptions, food decomposition, and conservative fallback estimation
- Composite dishes follow a `recipe / AI ingredients -> per-ingredient DB lookup -> runtime aggregation` pipeline
- The UI tracks complete 23-field nutrition groups including potassium, zinc, vitamin A/C/D/B12, and folate
- Weight adjustments in the confirmation dialog are recalculated locally without spending extra model budget
- Runtime observability covers lookup misses, parse telemetry, error telemetry, and materialized-view refresh state

## Lookup Priority

1. `recipe_alias` exact match to a standard recipe
2. `canonical_food_alias` exact match to a canonical food
3. Direct `app_catalog_profile_23.food_name_zh` match
4. Gemini fallback with conservative validation and value clamping

## Runtime Nutrition Pipeline

- `core.portion_reference` provides canonical Chinese serving-size references and unit conversions
- Safe `pg_trgm` fuzzy matching replaces dangerous `ILIKE '%term%'` substring lookups
- Runtime validation rejects obviously inconsistent DB candidates in strict categories, falling back to curated brand nutrition where needed
- `app.food_log_item.per100g_profile` and `app.food_log_item.totals_profile` store complete 23-field nutrition JSON
- `app.lookup_miss_telemetry` maintains a feedback loop for alias and ETL cleanup
- `app.food_parse_telemetry`, `app.runtime_error_telemetry`, and `app.materialized_view_refresh_state` support production health checks and refresh orchestration

## Technical Architecture

### Frontend

- Next.js 15 App Router + React 19 Server Components
- Tailwind CSS 3.4 responsive layout
- shadcn/ui component library (built on Radix UI)
- Form validation: React Hook Form + Zod
- Chart visualization: Recharts

### Backend

- Next.js Server Actions (type-safe server operations)
- PostgreSQL 16 + pg_trgm extension
- Materialized views for high-frequency query acceleration
- Gemini AI natural-language food parsing engine

### AI Parsing Engine

- Multi-level prompt templates: simple foods, composite dishes, portion estimation
- Conservative validation strategy: nutrient value clamping, outlier rejection
- Parse telemetry: records input/output and latency for every AI invocation

## Directory Structure

```text
fitness-food/
├── src/
│   ├── ai/             # AI parsing engine, prompt templates, and nutrition fallback logic
│   ├── app/            # Next.js 15 pages, layouts, and typed Server Actions
│   ├── components/     # UI components and nutrition dashboard modules
│   ├── lib/            # DB lookup, validation, runtime aggregation, and utilities
│   └── hooks/          # Data flow management and state helpers
├── db/                 # SQL migrations, reports, and refresh scripts
├── deploy/             # Deployment config and systemd assets
├── docs/               # Project documentation
└── package.json        # Dependencies and lifecycle scripts
```

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 16 (with pg_trgm extension enabled)

### Install

```bash
git clone https://github.com/saudademjj/fitness-food.git
cd fitness-food
npm install
```

### Database Bootstrap

1. Run migrations:

```bash
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260317_nutrition_runtime_hardening.sql
psql "$DATABASE_URL" -f db/migrations/20260317_runtime_composite_observability.sql
psql "$DATABASE_URL" -f db/migrations/20260319_runtime_lookup_brand_safety.sql
```

2. Refresh materialized views:

```bash
bash ./db/refresh_materialized_views.sh
```

### Start Development Server

```bash
npm run dev
```

Visit `http://localhost:9002` to use the application.

### Other Commands

```bash
npm run build        # Production build
npm run test         # Run tests
npm run typecheck    # Type checking
npm run lint         # Linting
```

## Runtime Health Check

```bash
npm run report:runtime-db    # Generate runtime database health report
```

This command checks materialized view refresh state, lookup miss statistics, and error telemetry summaries.

## License

MIT License
