'use client';

import React, {useState} from 'react';
import {Card, CardContent} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Droplets,
  Eye,
  Flame,
  Leaf,
  Shield,
  Sparkles,
  Wheat,
  Zap,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {GOAL_FIELD_GROUPS, type GoalFieldKey, type MacroGoals} from './types';
import {
  coalesceNutritionValue,
  getNutrientFieldMeta,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';

interface DashboardSummaryProps {
  totals: NutritionProfile23;
  totalsMeta: NutritionProfileMeta23;
  goals: MacroGoals;
}

const FEATURED_KEYS: GoalFieldKey[] = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
];

const FEATURED_ICON_BG: Record<string, string> = {
  energyKcal: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  proteinGrams: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  carbohydrateGrams: 'bg-lime-100 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400',
  fatGrams: 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
};

function formatDisplayValue(
  value: number | null,
  status: NutritionProfileMeta23[GoalFieldKey]['status']
): string {
  if (value === null) {
    return '--';
  }

  return status === 'partial' ? `>= ${value.toFixed(1)}` : value.toFixed(1);
}

export function DashboardSummary({totals, totalsMeta, goals}: DashboardSummaryProps) {
  const [showDetails, setShowDetails] = useState(false);
  const allFields = GOAL_FIELD_GROUPS.flatMap((group) => group.fields);
  const measuredCount = allFields.filter(
    (field) => totalsMeta[field.key].status === 'measured'
  ).length;
  const reviewCount = allFields.filter((field) =>
    ['estimated', 'partial'].includes(totalsMeta[field.key].status)
  ).length;
  const missingCount = allFields.filter(
    (field) => totalsMeta[field.key].status === 'missing'
  ).length;

  const renderIcon = (key: GoalFieldKey) => {
    if (key === 'energyKcal') {
      return <Flame className="h-4 w-4" />;
    }
    if (key === 'proteinGrams') {
      return <Zap className="h-4 w-4" />;
    }
    if (key === 'carbohydrateGrams') {
      return <Wheat className="h-4 w-4" />;
    }
    if (key === 'fatGrams') {
      return <Droplets className="h-4 w-4" />;
    }
    if (
      key === 'fiberGrams' ||
      key === 'potassiumMg' ||
      key === 'vitaminCMg' ||
      key === 'vitaminAMcg'
    ) {
      return <Leaf className="h-4 w-4" />;
    }
    if (key === 'sodiumMg' || key === 'sugarsGrams') {
      return <AlertTriangle className="h-4 w-4" />;
    }
    return <Shield className="h-4 w-4" />;
  };

  const renderNutrientCard = (key: GoalFieldKey) => {
    const meta = getNutrientFieldMeta(key);
    const value = coalesceNutritionValue(totals[key]);
    const goal = goals[key];
    const pct = goal > 0 && value !== null ? Math.min((value / goal) * 100, 100) : 0;

    return (
      <Card key={key} className="border-none shadow-sm bg-card/80 dark:bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {renderIcon(key)}
            <span>{meta.label}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-foreground">
            {formatDisplayValue(value, totalsMeta[key].status)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              / {goal} {meta.unit}
            </span>
          </div>
          <Progress value={pct} className={`mt-2 h-1.5 ${meta.tone}`} />
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mb-8 animate-fade-in-up">
      <div className="flex flex-col gap-4">
        {/* Featured macros */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FEATURED_KEYS.map((key) => {
            const meta = getNutrientFieldMeta(key);
            const value = coalesceNutritionValue(totals[key]);
            const goal = goals[key];
            const pct = goal > 0 && value !== null ? Math.min((value / goal) * 100, 100) : 0;

            return (
              <Card key={key} className="group relative overflow-hidden border-none shadow-md bg-card/90 dark:bg-card/60 animate-fade-in-up">
                {/* Decorative icon background */}
                <div className="absolute -right-2 -top-2 opacity-[0.07] transition-opacity group-hover:opacity-[0.12]">
                  <div className="text-[64px]">
                    {renderIcon(key)}
                  </div>
                </div>
                <CardContent className="relative p-4">
                  <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${FEATURED_ICON_BG[key] ?? ''}`}>
                    {renderIcon(key)}
                    {meta.label}
                  </div>
                  <div className="text-2xl font-bold text-foreground">
                    {formatDisplayValue(value, totalsMeta[key].status)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {meta.unit}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={pct} className={`h-2 flex-1 animate-progress-glow ${meta.tone}`} />
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    目标 {goal} {meta.unit}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Status cards + expand toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid flex-1 grid-cols-3 gap-3">
            <Card className="border-none bg-emerald-50/80 dark:bg-emerald-900/20 shadow-sm animate-fade-in-up stagger-1">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  已测量
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-900 dark:text-emerald-300">{measuredCount}</div>
                <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/70">数据库可靠值</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-amber-50/80 dark:bg-amber-900/20 shadow-sm animate-fade-in-up stagger-2">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  <Eye className="h-3 w-3" />
                  待复核
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-900 dark:text-amber-300">{reviewCount}</div>
                <div className="text-[10px] text-amber-700/80 dark:text-amber-400/70">含估算或部分缺失</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-slate-100/90 dark:bg-slate-800/40 shadow-sm animate-fade-in-up stagger-3">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  <AlertTriangle className="h-3 w-3" />
                  缺失
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-300">{missingCount}</div>
                <div className="text-[10px] text-slate-600/80 dark:text-slate-400/70">当前没有可靠值</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Expand/collapse details */}
      <div className="mt-3 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDetails(!showDetails)}
          className="rounded-full text-xs text-muted-foreground hover:text-primary"
        >
          {showDetails ? (
            <>
              收起详情 <ChevronUp className="ml-1 h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开 23 项营养详情 <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>

      {showDetails && (
        <div className="mt-4 space-y-4 animate-slide-expand">
          {GOAL_FIELD_GROUPS.map((group, groupIndex) => (
            <div key={group.id} className={`animate-fade-in-up stagger-${Math.min(groupIndex + 1, 6)}`}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {group.fields.map((field) => renderNutrientCard(field.key))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
