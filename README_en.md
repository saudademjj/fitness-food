<div align="center">

English | <a href="./README.md">简体中文</a>

# Fitness-Food

### Diet Management & AI Nutrition Analysis System

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![Qwen](https://img.shields.io/badge/Qwen_3.5-Enabled-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

Fitness-Food is an intelligent diet management system designed for Chinese-speaking users. Record meals through natural language descriptions -- the system prioritizes exact matches from a PostgreSQL nutrition database, invokes Qwen 3.5 AI only when necessary, and outputs a complete 23-nutrient tracking profile.

</div>

---

## Table of Contents

- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Nutrition Lookup Pipeline](#nutrition-lookup-pipeline)
- [23-Nutrient Tracking](#23-nutrient-tracking)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Available Commands](#available-commands)
- [Runtime Observability](#runtime-observability)
- [Authentication](#authentication)
- [Deployment](#deployment)
- [License](#license)

---

## Core Features

### Intelligent Food Parsing

- Natural language input such as "a bowl of rice and two fried eggs" is automatically split into individual food entries
- Composite dishes (e.g. "tomato scrambled eggs") are decomposed into ingredients, each resolved against the database, then aggregated at runtime
- Smart portion estimation recognizes size modifiers (small / medium / large / extra-large) and adjusts for cooking methods (raw / cooked / stir-fried / deep-fried / roasted / stewed / soup)

### Database-First Strategy

- Simple food descriptions hit PostgreSQL directly with zero model invocation overhead
- Qwen 3.5 AI serves only as a fallback for complex descriptions and unmatched items
- Safe `pg_trgm` trigram matching replaces dangerous `ILIKE '%term%'` substring queries
- Brand foods (e.g. Coca-Cola, McNuggets) use curated brand nutrition overrides

### Complete Nutrition Tracking

- Tracks 23 nutrients, far beyond the traditional calories / protein / carbs / fat model
- Nutrients displayed in groups: macronutrients, electrolytes, minerals, vitamins
- Each entry annotated with data source and reliability (exact match / fuzzy match / AI estimate / composite aggregation)
- Weight adjustments in the confirmation dialog recalculate nutrition locally without spending additional model budget

### Interactive Dashboard

- Four core metrics (calories, protein, carbs, fat) with real-time progress bars
- Expandable 23-nutrient detail grid with color-coded grouping
- Each food entry displays match mode, confidence percentage, and validation flags
- Recharts-based nutrition trend visualization

### Dual-Mode User System

- Anonymous users: data stored locally in the browser, zero setup required
- Authenticated users: Magic Link email login with data synced to PostgreSQL
- One-click migration of local drafts to the cloud after login

---

## System Architecture

```
                  User Input (Natural Language)
                           |
                    +------v------+
                    | Text Preprocessing | Normalization, segmentation, quantity extraction
                    +------+------+
                           |
              +------------v------------+
              |   Direct Parser (Fast Path)  |
              +------------+------------+
                           |
            +--------------+--------------+
            |              |              |
     Single Food      Multi-Food     Composite Dish
       Match          Splitting       Detection
            |              |              |
            v              v              v
    +-------+-------+  Per-Segment   Recipe Ingredient
    | 4-Tier Lookup |  Resolution    Lookup + Runtime
    |   Priority    |     |          Aggregation
    +-------+-------+     |              |
            |              +---------+----+
            v                        |
    +-------+--------+              v
    | Nutrition Data  |<-----------+
    | Assembly (23)   |
    +-------+---------+
            |
            v
    +-------+---------+
    | Validation &     |  Outlier rejection, thermodynamic consistency
    | Telemetry        |
    +-------+---------+
            |
            v
    +-------+---------+
    | Confirmation     |  Weight adjustment, local recalculation
    | Dialog           |
    +-------+---------+
            |
            v
    +-------+---------+
    | Persistence      |  Local / PostgreSQL
    +-----------------+
```

---

## Nutrition Lookup Pipeline

The system uses a four-tier priority strategy, attempting each level until a match is found:

| Priority | Lookup Layer | Description |
|:---:|---|---|
| 1 | `recipe_alias` | Exact match against standard recipe names |
| 2 | `canonical_food_alias` | Exact match against canonical food aliases |
| 3 | `app_catalog_profile_23` | Food catalog direct match + `pg_trgm` fuzzy matching |
| 4 | Qwen 3.5 AI Fallback | Natural language parsing with conservative validation and value clamping |

Key mechanisms:

- Materialized views accelerate high-frequency queries, refreshed daily via systemd timers
- Runtime validation rejects obviously inconsistent database candidates in strict categories
- `lookup_miss_telemetry` maintains a feedback loop driving alias additions and ETL cleanup
- AI invocations record complete input/output, token consumption, and latency for cost monitoring

---

## 23-Nutrient Tracking

| Group | Nutrients |
|---|---|
| Macronutrients | Energy (kcal), Protein (g), Carbohydrates (g), Fat (g), Dietary Fiber (g), Sugars (g) |
| Electrolytes | Sodium (mg), Potassium (mg) |
| Minerals | Calcium (mg), Magnesium (mg), Iron (mg), Zinc (mg) |
| Vitamins | Vitamin A (mcg), Vitamin C (mg), Vitamin D (mcg), Vitamin E (mg), Vitamin K (mcg), Thiamin B1 (mg), Riboflavin B2 (mg), Niacin B3 (mg), Vitamin B6 (mg), Vitamin B12 (mcg), Folate (mcg) |

Each food entry stores both `per100g_profile` (per-100g nutrition) and `totals_profile` (actual intake totals), annotated with data status: measured / estimated / partially missing / missing.

---

## Tech Stack

### Frontend

| Technology | Purpose |
|---|---|
| Next.js 15 App Router | Page routing and server-side rendering |
| React 19 Server Components | Server components with streaming |
| Tailwind CSS 3.4 | Responsive styling system |
| shadcn/ui (Radix UI) | Accessible UI component library |
| React Hook Form + Zod | Form management with type-safe validation |
| Recharts | Nutrition data chart visualization |
| Lucide React | Icon library |

### Backend

| Technology | Purpose |
|---|---|
| Next.js Server Actions | Type-safe server operations |
| PostgreSQL 16 | Primary database for nutrition data and user logs |
| pg_trgm Extension | Trigram fuzzy matching |
| Materialized Views | High-frequency query acceleration |
| node-pg | Database connection pooling |

### AI & Parsing

| Technology | Purpose |
|---|---|
| DashScope / Qwen API | Natural language food description parsing |
| Multi-level Prompt Templates | Simple foods / composite dishes / portion estimation |
| Conservative Validation | Nutrient value clamping, outlier rejection, thermodynamic consistency checks |
| Parse Telemetry | Records input/output, tokens, and latency for every AI invocation |

### Authentication & Security

| Technology | Purpose |
|---|---|
| Magic Link Email Auth | Passwordless login with 15-minute link TTL |
| Session Management | 30-day session validity |
| Rate Limiting | Anonymous: 8 req/min, Authenticated: 20 req/min |

---

## Directory Structure

```text
fitness-food/
├── src/
│   ├── ai/
│   │   └── flows/
│   │       └── parse-food-description-flow.ts   # AI orchestration: direct parse -> segmentation -> Qwen fallback
│   ├── app/
│   │   ├── page.tsx                             # Main page and state coordinator
│   │   ├── layout.tsx                           # Root layout
│   │   ├── auth/callback/route.ts               # Magic Link callback handler
│   │   └── actions/
│   │       ├── auth.ts                          # Authentication Server Actions
│   │       ├── food.ts                          # Food parsing Server Actions (with rate limiting)
│   │       └── logs.ts                          # Food log CRUD, export, local migration
│   ├── components/
│   │   ├── macro-calculator/
│   │   │   ├── dashboard-summary.tsx            # Nutrition dashboard (4 core metrics + 23-nutrient details)
│   │   │   ├── food-input-form.tsx              # Natural language food input form
│   │   │   ├── food-log-list.tsx                # Food entry list (with metadata badges)
│   │   │   ├── confirmation-dialog.tsx          # Parse confirmation dialog (weight adjustment)
│   │   │   ├── nutrition-detail-grid.tsx        # 23-nutrient grid display
│   │   │   └── types.ts                        # Type definitions
│   │   └── ui/                                  # 35 shadcn/ui base components
│   ├── hooks/
│   │   ├── use-food-log.ts                      # Food log state management
│   │   └── use-mobile.tsx                       # Mobile detection
│   └── lib/
│       ├── nutrition-profile.ts                 # 23-nutrient field definitions and aggregation
│       ├── nutrition-db.ts                      # 4-tier priority database resolver
│       ├── food-contract.ts                     # Zod schemas and validation flags
│       ├── food-text.ts                         # Text normalization and food name parsing
│       ├── direct-food-parser.ts                # Fast path for simple descriptions
│       ├── composite-dish.ts                    # Recipe ingredient lookup and aggregation
│       ├── portion-reference.ts                 # Portion estimation with cooking adjustments
│       ├── validation.ts                        # Macro validation and consistency checks
│       ├── food-log-db.ts                       # Food log database queries
│       ├── auth.ts                              # Magic Link auth and session management
│       ├── runtime-observability.ts             # Parse telemetry and error tracking
│       ├── ai-usage-telemetry.ts                # Qwen API usage tracking
│       ├── miss-telemetry.ts                    # Lookup miss feedback loop
│       └── ...                                  # DB connection, rate limiting, utilities
├── db/
│   ├── migrations/                              # 9 SQL migration scripts
│   └── refresh_materialized_views.sh            # Materialized view refresh script
├── deploy/
│   └── systemd/                                 # Daily refresh timer and service
├── docs/                                        # Project documentation
├── scripts/                                     # Runtime health report scripts
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 16 (with `pg_trgm` extension enabled)

### Installation

```bash
git clone https://github.com/saudademjj/fitness-food.git
cd fitness-food
npm install
```

### Start Development Server

```bash
npm run dev
```

Visit `http://localhost:9002` to use the application.

---

## Environment Variables

Create a `.env.local` file in the project root:

```bash
# Database (required)
DATABASE_URL=postgresql://localhost:5432/foodetl_local

# DashScope / Qwen (required for AI fallback)
DASHSCOPE_API_KEY=your_dashscope_api_key
QWEN_MODEL=qwen3.5-plus
QWEN_ENABLE_THINKING=true
QWEN_ENABLE_SEARCH=true
QWEN_FORCE_SEARCH=false
QWEN_SEARCH_STRATEGY=turbo
QWEN_REQUEST_TIMEOUT_MS=45000

# Magic Link Auth (optional -- anonymous mode if not configured)
APP_BASE_URL=http://localhost:9002
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=noreply@example.com
```

The system runs in anonymous-only mode when SMTP variables are not configured.

---

## Database Setup

1. Run migration scripts in order:

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

If the application fails to start because nutrition materialized views are empty, the refresh likely did not complete successfully.

---

## Available Commands

| Command | Description |
|---|---|
| `npm run dev` | Start development server (port 9002, Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run test` | Run all tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint code linting |
| `npm run report:runtime-db` | Generate runtime database health report |

---

## Runtime Observability

```bash
npm run report:runtime-db
```

This command outputs:

- Materialized view refresh state and timestamps
- Lookup miss statistics for ETL feedback
- Error telemetry summaries
- Parse telemetry aggregates

The system records telemetry across multiple dimensions:

| Telemetry Table | Purpose |
|---|---|
| `food_parse_telemetry` | Input/output and latency for every parse operation |
| `ai_usage_telemetry` | Qwen API token consumption and cost tracking |
| `lookup_miss_telemetry` | Unmatched food names driving alias and ETL improvements |
| `runtime_error_telemetry` | Runtime error tracking for production health |
| `materialized_view_refresh_state` | View refresh orchestration and staleness detection |

---

## Authentication

The system uses a Magic Link passwordless authentication scheme:

1. User enters their email address; the system generates a one-time login link (15-minute TTL)
2. User clicks the link in the email to complete login
3. A 30-day session is created upon successful authentication
4. Authenticated users' food logs sync to PostgreSQL
5. After login, local anonymous data can be migrated to the cloud in one click

When SMTP is not configured, the system operates in anonymous mode with data stored only in the browser.

---

## Deployment

The project includes systemd timer configurations for automated daily materialized view refresh in production:

```text
deploy/systemd/
├── fitness-food-refresh.service    # Refresh service unit
└── fitness-food-refresh.timer      # Daily trigger timer
```

See [docs/deployment.md](./docs/deployment.md) for the full deployment guide.

The project also provides an `apphosting.yaml` configuration file for deployment on Firebase App Hosting and similar platforms.

---

## License

This project is open-sourced under the [MIT License](./LICENSE).
