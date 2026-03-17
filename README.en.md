# Fitness Food

[中文说明](./README.md)

`Fitness Food` is a Chinese nutrition logging app built with `Next.js 15`. The current version uses a database-first nutrition pipeline: simple food phrases are resolved directly from PostgreSQL whenever possible, while `Gemini 3 Flash Preview` is only used for complex descriptions, default portion estimation, and controlled fallback nutrition estimates.

## Highlights

- Simple single-food descriptions hit the PostgreSQL nutrition database first
- `Gemini 3 Flash Preview` is used only when the input is complex or ambiguous
- The UI shows grouped progress for a full set of `23` nutrition targets
- Weight adjustments are recalculated locally after confirmation, without re-spending model calls
- Magic-link login, cloud history, export, rate limiting, and local draft migration are included

## Resolution Priority

1. Standard recipes via `recipe_alias`
2. Canonical foods via `canonical_food_alias`
3. Direct match from `app_catalog_profile_23.food_name_zh`
4. Gemini fallback with conservative correction when no database match is available

## New Runtime Capabilities

- `core.portion_reference` for default portions and Chinese quantity mappings
- `pg_trgm` plus safer fuzzy lookup logic
- Additional consistency checks for Gemini fallback values
- `app.*` runtime tables for users, sessions, history, exports, and rate limits
- `JSONB` storage for full 23-field nutrition profiles
- Lookup miss telemetry for improving aliases and ETL coverage later

## Tech Stack

- Frontend: `Next.js 15`, `React 19`, `TypeScript`
- UI: `Tailwind CSS`, `Radix UI`
- Data layer: `PostgreSQL`
- AI: `Gemini 3 Flash Preview`
- Deployment: suited to Debian + Nginx self-hosting

## Database Setup

1. Run migrations:

```bash
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
```

2. Refresh the materialized views:

```bash
bash ./db/refresh_materialized_views.sh
```

## Local Development

1. Install dependencies

```bash
npm install
```

2. Create local environment variables

```bash
cp .env.example .env.local
```

3. Fill in at least these values:

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3-flash-preview
APP_BASE_URL=http://localhost:9002
DATABASE_URL=postgresql://localhost:5432/foodetl_local
SMTP_HOST=smtp.your-provider.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=Fitness Food <noreply@example.com>
```

4. Start development:

```bash
npm run dev
```

5. Open `http://localhost:9002`

## Production Notes

- Run the app on Debian, connect it to PostgreSQL, and place Nginx in front for HTTPS
- Magic-link login requires `APP_BASE_URL` and SMTP configuration
- Keep model usage low by only calling Gemini for natural-language parsing when the database cannot directly answer
- Refresh materialized views after alias, portion, or ETL publish-layer updates

## Useful Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run report:runtime-db`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
