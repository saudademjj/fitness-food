<div align="center">
  English | <a href="./README.md">简体中文</a>
</div>

# Fitness-Food (Diet Management & AI Nutrition Analysis System)

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

An intelligent full-stack diet tracking and nutrition analysis application. It combines intuitive data visualization with Large Language Model (LLM) semantic analysis to simplify daily nutrition logging and provide precise dietary feedback for fitness and health goals.

## 🏛️ Engineering & Technical Analysis

### 1. Modern Full-stack Architecture
- **Next.js 15 (App Router)**: The core routing logic is built on Next.js 15. By leveraging Server Components, we offload complex database queries to the server, significantly reducing client-side JS execution overhead.
- **React 19 Concurrent Mode**: Utilizing the latest React 19 features, the system maintains high interface responsiveness even during frequent interactions like chart rendering and form validation.

### 2. AI-Powered Ingestion Pipeline
Traditional logging systems require manual food searches, which is often inefficient. This project introduces an **AI Semantic Parser**:
- **Logic Flow**: Natural language input -> Backend AI parser identifies food items and approximate quantities -> Calorie and macronutrient estimation based on built-in DBs or LLM knowledge.
- **Prompt Engineering**: Located in `src/ai`, our system prompts are meticulously designed for standardized and high-accuracy nutritional decomposition.

### 3. Data Visualization Engineering
Integrated **Recharts** for real-time monitoring dashboards:
- **Macronutrient Dashboard**: Doughnut charts (Pie Charts) provide real-time feedback on daily intake ratios, guiding users towards balanced nutrition.
- **Dynamic Trend Analysis**: Smooth line charts correlate intake with weight fluctuations, supporting dynamic time-range filtering.

## 📂 Core Directory Structure

```text
fitness-food/
├── src/
│   ├── ai/             # Core AI logic, prompt templates, and data normalization
│   ├── app/            # Next.js 15 pages, layouts, and strongly-typed API endpoints
│   ├── components/     # UI primitives, business dashboards, and Recharts wrappers
│   ├── lib/            # Edge-optimized DB connection pools and core utilities
│   └── hooks/          # Data flow, SWR synchronization, and state persistence
├── db/                 # SQL initialization, schema definitions, and seed data
├── deploy/             # Environmental orchestration for rapid deployment
└── package.json        # Comprehensive dependency and lifecycle management
```

## 🚀 Quick Start for Developers

### 1. Requirements
- Node.js >= 20
- PostgreSQL >= 16

### 2. Deployment
```bash
# Install dependencies
npm install

# Configure .env.local
# DATABASE_URL=postgresql://user:password@localhost:5432/fitness_food

# Initialize Database Schema
npm run db:setup

# Launch High-Performance Dev Environment
npm run dev
```

## License
MIT License
