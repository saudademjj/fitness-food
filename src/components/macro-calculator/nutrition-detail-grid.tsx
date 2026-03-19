'use client';

import React from 'react';
import {
  NUTRIENT_GROUPS,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';

interface NutritionDetailGridProps {
  profile: NutritionProfile23;
  meta: NutritionProfileMeta23;
}

function formatValue(value: number | null, status: NutritionProfileMeta23[keyof NutritionProfileMeta23]['status']): string {
  if (value === null) {
    return '--';
  }

  return status === 'partial' ? `>= ${value.toFixed(1)}` : value.toFixed(1);
}

function statusDot(status: NutritionProfileMeta23[keyof NutritionProfileMeta23]['status']): string {
  if (status === 'measured') return 'bg-emerald-500';
  if (status === 'estimated' || status === 'partial') return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

function formatHint(status: NutritionProfileMeta23[keyof NutritionProfileMeta23]['status']): string {
  if (status === 'missing') {
    return '缺失';
  }
  if (status === 'partial') {
    return '部分缺失';
  }
  if (status === 'estimated') {
    return '估算';
  }
  return '已测量';
}

const GROUP_BAR_COLORS: Record<string, string> = {
  macros: 'bg-primary',
  electrolytes: 'bg-amber-500',
  minerals: 'bg-sky-500',
  vitamins: 'bg-violet-500',
};

export function NutritionDetailGrid({profile, meta}: NutritionDetailGridProps) {
  return (
    <div className="space-y-4">
      {NUTRIENT_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`inline-block h-3.5 w-1 rounded-full ${GROUP_BAR_COLORS[group.id] ?? 'bg-primary'}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {group.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {group.fields.map((field) => (
              <div key={field.key} className="rounded-xl border border-border/60 bg-card/70 dark:bg-card/50 p-3">
                <div className="text-[11px] text-muted-foreground">{field.label}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {formatValue(profile[field.key], meta[field.key].status)}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {field.unit}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot(meta[field.key].status)}`} />
                  {formatHint(meta[field.key].status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
