'use client';

import React, {useState} from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Droplets,
  Flame,
  Leaf,
  Shield,
  Wheat,
  Zap,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {GOAL_FIELDS, type GoalFieldKey, type MacroGoals} from './types';
import {NutritionDetailGrid} from '@/components/macro-calculator/nutrition-detail-grid';
import type {NutritionProfile23} from '@/lib/nutrition-profile';

interface DashboardSummaryProps {
  totals: NutritionProfile23;
  goals: MacroGoals;
}

export function DashboardSummary({ totals, goals }: DashboardSummaryProps) {
  const [showDetails, setShowDetails] = useState(false);

  const iconByKey: Record<GoalFieldKey, React.ReactNode> = {
    energyKcal: <Flame className="h-4 w-4" />,
    proteinGrams: <Zap className="h-4 w-4" />,
    carbohydrateGrams: <Wheat className="h-4 w-4" />,
    fatGrams: <Droplets className="h-4 w-4" />,
    fiberGrams: <Leaf className="h-4 w-4" />,
    sodiumMg: <AlertTriangle className="h-4 w-4" />,
    calciumMg: <Shield className="h-4 w-4" />,
    ironMg: <Shield className="h-4 w-4" />,
  };

  const getProgress = (current: number | undefined, goal: number) => {
    if (!current || isNaN(current) || goal <= 0) return 0;
    return Math.min((current / goal) * 100, 100);
  };

  const renderNutrientCard = (key: GoalFieldKey) => {
    const goal = goals[key];
    const field = GOAL_FIELDS.find((item) => item.key === key)!;
    const value = totals[key] || 0;
    const safeValue = isNaN(value) ? 0 : value;
    const percent = getProgress(safeValue, goal);
    return (
      <Card
        key={field.label}
        className="overflow-hidden border-none bg-white/50 shadow-sm backdrop-blur-sm"
      >
        <CardContent className="p-3">
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className={`rounded-full p-1 ${field.tone}/10 text-primary`}>
                {iconByKey[key]}
              </div>
              <h3 className="font-headline font-semibold text-xs">{field.label}</h3>
            </div>
            <div className="text-right">
              <span className="font-bold text-xs">{safeValue.toFixed(1)}</span>
              <span className="ml-0.5 text-[9px] text-muted-foreground">
                / {goal} {field.unit}
              </span>
            </div>
          </div>
          <Progress value={percent} className={`h-1 ${field.tone}`} />
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">今日营养进度</p>
          <p className="text-xs text-muted-foreground">
            宏量营养 + 纤维/钠/钙/铁都会累计展示，数据库命中优先，查不到才回退到 AI 估算。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowDetails((current) => !current)}
          className="h-auto rounded-full px-0 text-xs font-medium text-primary hover:bg-transparent"
        >
          {showDetails ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
          {showDetails ? '收起今日 23 项详情' : '展开今日 23 项详情'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {GOAL_FIELDS.map((field) => renderNutrientCard(field.key))}
      </div>
      {showDetails ? (
        <div className="mt-4 rounded-2xl border border-border/70 bg-white/60 p-4">
          <NutritionDetailGrid profile={totals} />
        </div>
      ) : null}
    </div>
  );
}
