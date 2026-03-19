'use client';

import React, {useState} from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {Pencil, Trash2, Scale, Zap, Wheat, Flame, Droplets, AlertTriangle, ChevronDown, ChevronUp, UtensilsCrossed} from 'lucide-react';
import { type FoodLogEntry } from './types';
import {
  formatValidationFlag,
  getMatchModeLabel,
  getReliabilityMeta,
  getSourceKindLabel,
} from '@/lib/source-meta';
import {NutritionDetailGrid} from '@/components/macro-calculator/nutrition-detail-grid';

interface FoodLogListProps {
  entries: FoodLogEntry[];
  onDelete: (id: string) => void;
  onEdit?: (entry: FoodLogEntry) => void;
  listTitle?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

const RELIABILITY_BAR_COLOR: Record<string, string> = {
  'border-emerald-200': 'bg-emerald-500',
  'border-sky-200': 'bg-sky-500',
  'border-amber-200': 'bg-amber-500',
  'border-amber-300': 'bg-amber-500',
  'border-slate-300': 'bg-slate-400',
};

function getBarColor(badgeClass: string): string {
  for (const [key, color] of Object.entries(RELIABILITY_BAR_COLOR)) {
    if (badgeClass.includes(key)) return color;
  }
  return 'bg-muted-foreground/30';
}

export function FoodLogList({
  entries,
  onDelete,
  onEdit,
  listTitle = '今日记录',
  emptyTitle = '今天还没有记录任何食物',
  emptyDescription = '开始输入饮食描述，系统会优先命中营养数据库，复杂描述再交给 Gemini 处理。',
}: FoodLogListProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 px-4 rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-card/50 dark:bg-card/30">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/60">
          <UtensilsCrossed className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <p className="text-muted-foreground font-medium">{emptyTitle}</p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-headline font-semibold text-lg px-1 flex items-center gap-2">
        {listTitle}
        <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
          {entries.length} 项
        </span>
      </h3>
      {entries.map((entry, entryIndex) => (
        <Card key={entry.id} className={`group overflow-hidden border-none shadow-sm hover:shadow-md transition-all duration-300 animate-fade-in-up stagger-${Math.min(entryIndex + 1, 6)}`}>
          <div className="flex">
            {/* Left reliability color bar */}
            {(() => {
              const reliability = getReliabilityMeta(entry);
              return <div className={`w-1 shrink-0 ${getBarColor(reliability.badgeClass)}`} />;
            })()}
            <CardContent className="flex-1 p-4 sm:p-5">
              {(() => {
                const isExpanded = Boolean(expandedIds[entry.id]);
                const reliability = getReliabilityMeta(entry);

                return (
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h4 className="font-bold text-lg text-foreground">{entry.foodName}</h4>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`rounded-full font-medium ${reliability.badgeClass}`}>
                      {reliability.label}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-muted-foreground">
                      {getSourceKindLabel(entry.sourceKind)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-muted-foreground">
                      {getMatchModeLabel(entry.matchMode)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      置信度 {Math.round(entry.confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {entry.sourceLabel}
                  </div>

                  {/* Compact macro summary with mini progress bars */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <NutrientMiniBar
                      label="热量"
                      value={entry.totals.energyKcal}
                      status={entry.totalsMeta.energyKcal.status}
                      unit="kcal"
                      icon={<Flame className="h-3 w-3 text-orange-500" />}
                      barColor="bg-orange-500"
                    />
                    <NutrientMiniBar
                      label="蛋白质"
                      value={entry.totals.proteinGrams}
                      status={entry.totalsMeta.proteinGrams.status}
                      unit="g"
                      icon={<Zap className="h-3 w-3 text-emerald-500" />}
                      barColor="bg-emerald-500"
                    />
                    <NutrientMiniBar
                      label="碳水"
                      value={entry.totals.carbohydrateGrams}
                      status={entry.totalsMeta.carbohydrateGrams.status}
                      unit="g"
                      icon={<Wheat className="h-3 w-3 text-lime-500" />}
                      barColor="bg-lime-500"
                    />
                    <NutrientMiniBar
                      label="脂肪"
                      value={entry.totals.fatGrams}
                      status={entry.totalsMeta.fatGrams.status}
                      unit="g"
                      icon={<Droplets className="h-3 w-3 text-sky-500" />}
                      barColor="bg-sky-500"
                    />
                  </div>

                  {entry.validationFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.validationFlags.map((flag) => (
                        <Badge key={flag} variant="outline" className="rounded-full text-[10px] text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700">
                          <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                          {formatValidationFlag(flag)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedIds((prev) => ({
                          ...prev,
                          [entry.id]: !prev[entry.id],
                        }))
                      }
                      className="rounded-full text-xs text-muted-foreground hover:text-primary px-2 h-7"
                    >
                      {isExpanded ? (
                        <>收起详情 <ChevronUp className="ml-1 h-3 w-3" /></>
                      ) : (
                        <>展开 23 项营养 <ChevronDown className="ml-1 h-3 w-3" /></>
                      )}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 animate-slide-expand">
                      <NutritionDetailGrid profile={entry.totals} meta={entry.totalsMeta} />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                    {entry.estimatedGrams}g
                  </div>
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                      onClick={() => onEdit(entry)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
                );
              })()}
            </CardContent>
          </div>
        </Card>
      ))}
    </div>
  );
}

function NutrientMiniBar({
  label,
  value,
  status,
  unit,
  icon,
  barColor,
}: {
  label: string;
  value: number | null;
  status: 'measured' | 'estimated' | 'partial' | 'missing';
  unit: string;
  icon: React.ReactNode;
  barColor: string;
}) {
  if (value === null || value === 0) return null;

  // Use a simple relative bar — cap at a reasonable visual max
  const maxVisual = unit === 'kcal' ? 800 : 60;
  const pct = Math.min((value / maxVisual) * 100, 100);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        <span className="font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 flex-1 rounded-full bg-secondary/60 overflow-hidden">
          <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{width: `${pct}%`}} />
        </div>
        <span className="text-[10px] font-bold text-foreground tabular-nums whitespace-nowrap">
          {status === 'partial' ? '>=' : ''}
          {value.toFixed(1)}
          <span className="font-normal text-muted-foreground ml-0.5">{unit}</span>
        </span>
      </div>
    </div>
  );
}
