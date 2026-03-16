'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Zap, Wheat, Flame, Droplets } from 'lucide-react';
import { type MacroGoals } from './types';

interface DashboardSummaryProps {
  totals: Partial<Record<keyof MacroGoals, number>>;
  goals: MacroGoals;
}

export function DashboardSummary({ totals, goals }: DashboardSummaryProps) {
  const getProgress = (current: number | undefined, goal: number) => {
    if (!current || isNaN(current) || goal <= 0) return 0;
    return Math.min((current / goal) * 100, 100);
  };

  const coreNutrients = [
    { label: '热量', key: 'energyKcal', goal: goals.energyKcal, unit: 'kcal', icon: <Flame className="h-4 w-4" />, color: 'bg-orange-500' },
    { label: '蛋白质', key: 'proteinGrams', goal: goals.proteinGrams, unit: 'g', icon: <Zap className="h-4 w-4" />, color: 'bg-primary' },
    { label: '碳水', key: 'carbohydrateGrams', goal: goals.carbohydrateGrams, unit: 'g', icon: <Wheat className="h-4 w-4" />, color: 'bg-accent' },
    { label: '脂肪', key: 'fatGrams', goal: goals.fatGrams, unit: 'g', icon: <Droplets className="h-4 w-4" />, color: 'bg-yellow-500' },
  ];

  const renderNutrientCard = (n: any) => {
    const value = totals[n.key as keyof MacroGoals] || 0;
    const safeValue = isNaN(value) ? 0 : value;
    const percent = getProgress(safeValue, n.goal);
    return (
      <Card key={n.label} className="overflow-hidden border-none shadow-sm bg-white/50 backdrop-blur-sm">
        <CardContent className="p-3">
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className={`p-1 rounded-full ${n.color}/10 text-primary`}>
                {n.icon}
              </div>
              <h3 className="font-headline font-semibold text-xs">{n.label}</h3>
            </div>
            <div className="text-right">
              <span className="font-bold text-xs">{safeValue.toFixed(1)}</span>
              <span className="text-muted-foreground text-[9px] ml-0.5">/ {n.goal}</span>
            </div>
          </div>
          <Progress value={percent} className={`h-1 ${n.color}`} />
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">今日核心营养</p>
          <p className="text-xs text-muted-foreground">数据库命中优先，查不到才回退到 AI 估算。</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {coreNutrients.map(renderNutrientCard)}
      </div>
    </div>
  );
}
