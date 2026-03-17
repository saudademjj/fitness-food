<div align="center">
  English | <a href="./README.md">简体中文</a>
</div>

# Fitness-Food (Diet Management & AI Nutrition Analysis System)

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

This project is a modern full-stack diet tracking and nutrition analysis application. Combining intuitive data visualization with the semantic analysis power of Large Language Models (LLMs), the system assists users in precisely managing daily nutritional intake through data-driven methods to achieve muscle gain or fat loss goals.

## Core Engineering Highlights

### 1. Multi-dimensional Nutrition Data Visualization
Integrated dynamic statistical modules powered by **Recharts**:
- **Real-time Dashboard**: Dynamically renders doughnut charts for daily protein, carbohydrate, and fat intake ratios.
- **Trend Analysis**: Provides line charts correlating calorie intake with weight fluctuations, assisting users in periodic reviews.

### 2. AI-Powered Interaction Experiments
The system introduces AI modules to optimize the often tedious process of traditional diet logging:
- **Unstructured Input**: Allows users to enter natural language (e.g., "ate a Big Mac and a small fries for lunch") and automatically decomposes nutritional components.
- **Intelligent Strategy Generation**: Dynamically provides dietary optimization suggestions based on the user's historical intake data and fitness goals.

### 3. Type-Safe Engineering Practices
- **End-to-End Validation**: Combines Zod and React Hook Form to implement dual schema validation at both the client-side and API endpoints, ensuring high accuracy of intake data.
- **Persistence Management**: Maintains user profiles and recipe libraries based on PostgreSQL, utilizing indexes to optimize paginated queries of historical records.

## Project Structure

```text
fitness-food/
├── src/
│   ├── ai/             # Core AI analysis engine and prompt templates
│   ├── app/            # Next.js 15 App Router pages and API endpoints
│   ├── components/     # UI primitives, business dashboards, and interactive charts
│   ├── hooks/          # Data flow management and state persistence logic
│   └── lib/            # DB client encapsulation and utility library
├── db/                 # SQL initialization scripts and schema definitions
├── deploy/             # Configuration files for environmental orchestration
└── package.json        # Dependency list and project life-cycle definitions
```

## License
This project is licensed under the MIT License.
