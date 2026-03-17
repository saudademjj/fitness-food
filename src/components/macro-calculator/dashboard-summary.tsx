'use client';

import React, {useState} from 'react';
import {Card, CardContent} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Droplets,
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
      key === 'vitaminKMcg' ||
      key === 'folateMcg'
    ) {
      return <Leaf className="h-4 w-4" />;
    }
    if (key === 'sugarsGrams' || key === 'sodiumMg') {
      return <AlertTriangle className="h-4 w-4" />;
    }
    if (getNutrientFieldMeta(key).group === 'vitamins') {
      return <Sparkles className="h-4 w-4" />;
    }
    return <Shield className="h-4 w-4" />;
  };

  const getProgress = (current: number | null, goal: number) => {
    if (current === null || isNaN(current) || goal <= 0) {
      return 0;
    }

    return Math.min((current / goal) * 100, 100);
  };

  const renderStatusHint = (key: GoalFieldKey) => {
    const meta = totalsMeta[key];
    if (meta.status === 'missing') {
      return '该营养素当前没有可靠数据';
    }
    if (meta.status === 'partial') {
      return '已汇总已知值，仍有部分记录缺失';
    }
    if (meta.status === 'estimated') {
      return meta.source === 'ai'
        ? '该值包含 AI 估算'
        : '该值包含模型换算或 AI 补齐';
    }
    return '已完成数据库可测量值汇总';
  };

  const renderNutrientCard = (key: GoalFieldKey) => {
    const goal = goals[key];
    const field = allFields.find((item) => item.key === key)!;
    const value = totals[key];
    const valueStatus = totalsMeta[key].status;
    const safeValue = coalesceNutritionValue(value);
    const percent = getProgress(value, goal);
    const isLimit = field.goalDirection === 'limit';
    const isExceeded = isLimit && goal > 0 && safeValue > goal;

    return (
      <Card
        key={field.label}
        className="overflow-hidden border-none bg-white/50 shadow-sm backdrop-blur-sm"
      >
        <CardContent className="p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`rounded-full p-1 ${field.tone}/10 text-primary`}>
                {renderIcon(key)}
              </div>
              <h3 className="font-headline text-xs font-semibold">{field.label}</h3>
            </div>
            <div className="text-right">
              <span className="font-bold text-xs">{formatDisplayValue(value, valueStatus)}</span>
              <span className="ml-0.5 text-[9px] text-muted-foreground">
                / {goal} {field.unit}
              </span>
            </div>
          </div>
          <Progress value={percent} className={`h-1 ${isExceeded ? 'bg-rose-500' : field.tone}`} />
          <div className="mt-2 text-[10px] text-muted-foreground">
            {valueStatus === 'missing'
              ? '缺失'
              : isLimit
                ? isExceeded
                  ? `已超过上限 ${Math.abs(safeValue - goal).toFixed(1)} ${field.unit}`
                  : `距离上限 ${(goal - safeValue).toFixed(1)} ${field.unit}`
                : `已完成 ${percent.toFixed(0)}%`}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground/80">{renderStatusHint(key)}</div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mb-8">
      <div className="rounded-[1.75rem] border border-border/70 bg-white/70 p-4 shadow-sm backdrop-blur-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-primary">今日营养进度</p>
            <p className="text-xs text-muted-foreground">
              默认先看核心四项，展开后再查看完整 23 项营养目标与状态。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowDetails((current) => !current)}
            className="h-auto self-start rounded-full px-0 text-xs font-medium text-primary hover:bg-transparent"
          >
            {showDetails ? (
              <ChevronUp className="mr-1 h-4 w-4" />
            ) : (
              <ChevronDown className="mr-1 h-4 w-4" />
            )}
            {showDetails ? '收起今日 23 项详情' : '展开今日 23 项详情'}
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {FEATURED_KEYS.map((key) => renderNutrientCard(key))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-none bg-emerald-50/80 shadow-sm">
              <CardContent className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  已测量
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-900">{measuredCount}</div>
                <div className="text-[10px] text-emerald-700/80">数据库可直接累计</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-amber-50/80 shadow-sm">
              <CardContent className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  待复核
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-900">{reviewCount}</div>
                <div className="text-[10px] text-amber-700/80">含估算或部分缺失</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-slate-100/90 shadow-sm">
              <CardContent className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  缺失
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{missingCount}</div>
                <div className="text-[10px] text-slate-600/80">当前没有可靠值</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {showDetails ? (
        <div className="mt-4 space-y-4">
          {GOAL_FIELD_GROUPS.map((group) => (
            <div key={group.id}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {group.fields.map((field) => renderNutrientCard(field.key))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
