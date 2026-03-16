'use client';

import React from 'react';
import {NUTRIENT_GROUPS, type NutritionProfile23} from '@/lib/nutrition-profile';

interface NutritionDetailGridProps {
  profile: NutritionProfile23;
}

function formatValue(value: number): string {
  return value.toFixed(1);
}

export function NutritionDetailGrid({profile}: NutritionDetailGridProps) {
  return (
    <div className="space-y-4">
      {NUTRIENT_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {group.label}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {group.fields.map((field) => (
              <div key={field.key} className="rounded-xl border border-border/60 bg-white/70 p-3">
                <div className="text-[11px] text-muted-foreground">{field.label}</div>
                <div className="mt-1 text-sm font-semibold text-primary">
                  {formatValue(profile[field.key])}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {field.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
