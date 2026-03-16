'use client';

import React, {useState} from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {Pencil, Trash2, Scale, Zap, Wheat, Flame, Droplets, AlertTriangle, ChevronDown, ChevronUp} from 'lucide-react';
import { type FoodLogEntry } from './types';
import {
  formatValidationFlag,
  getMatchModeLabel,
  getSourceKindLabel,
} from '@/lib/source-meta';
import {NutritionDetailGrid} from '@/components/macro-calculator/nutrition-detail-grid';

interface FoodLogListProps {
  entries: FoodLogEntry[];
  onDelete: (id: string) => void;
  onEdit?: (entry: FoodLogEntry) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function FoodLogList({
  entries,
  onDelete,
  onEdit,
  emptyTitle = '今天还没有记录任何食物',
  emptyDescription = '开始输入饮食描述，系统会优先命中营养数据库，复杂描述再交给 Gemini 处理。',
}: FoodLogListProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 px-4 bg-white/30 rounded-2xl border-2 border-dashed border-muted-foreground/20">
        <p className="text-muted-foreground">{emptyTitle}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-headline font-semibold text-lg px-1 flex items-center gap-2">
        今日记录
        <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
          {entries.length} 项
        </span>
      </h3>
      {entries.map((entry) => (
        <Card key={entry.id} className="group overflow-hidden border-none shadow-sm hover:shadow-md transition-all duration-300">
          <CardContent className="p-4 sm:p-5">
            {(() => {
              const isExpanded = Boolean(expandedIds[entry.id]);
              const sourceBadgeClass =
                entry.sourceKind === 'ai_fallback'
                  ? entry.validationFlags.includes('ai_macro_clamped')
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-slate-300 bg-slate-50 text-slate-700'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';

              return (
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <h4 className="font-bold text-lg text-primary">{entry.foodName}</h4>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`rounded-full ${sourceBadgeClass}`}>
                    {getSourceKindLabel(entry.sourceKind)}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    {getMatchModeLabel(entry.matchMode)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    置信度 {Math.round(entry.confidence * 100)}%
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {entry.sourceLabel}
                </div>
                {entry.sourceKind === 'ai_fallback' ? (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    AI 估算项：宏量可作参考，钠/钙/铁等微量营养素建议结合包装或数据库条目复核。
                  </div>
                ) : null}
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Scale className="h-3 w-3" />
                    {entry.quantityDescription || '未知分量'} ({entry.estimatedGrams || 0}g)
                  </span>
                </div>
                {entry.validationFlags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.validationFlags.map((flag) => (
                      <Badge
                        key={flag}
                        variant="outline"
                        className="rounded-full border-amber-300 bg-amber-50 text-amber-700"
                      >
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {formatValidationFlag(flag)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4">
                  <NutrientBadge label="热量" value={entry.totals.energyKcal} unit="kcal" icon={<Flame className="h-3 w-3" />} />
                  <NutrientBadge label="蛋白质" value={entry.totals.proteinGrams} unit="g" icon={<Zap className="h-3 w-3 fill-current" />} />
                  <NutrientBadge label="碳水" value={entry.totals.carbohydrateGrams} unit="g" icon={<Wheat className="h-3 w-3" />} />
                  <NutrientBadge label="脂肪" value={entry.totals.fatGrams} unit="g" icon={<Droplets className="h-3 w-3" />} />
                </div>

                <div className="mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setExpandedIds((current) => ({
                        ...current,
                        [entry.id]: !isExpanded,
                      }))
                    }
                    className="h-auto rounded-full px-0 text-xs font-medium text-primary hover:bg-transparent"
                  >
                    {isExpanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                    {isExpanded ? '收起 23 项营养详情' : '展开 23 项营养详情'}
                  </Button>
                </div>

                {isExpanded ? (
                  <div className="mt-4 space-y-4 rounded-2xl border border-border/70 bg-secondary/10 p-4">
                    <div>
                      <div className="mb-2 text-xs font-semibold text-primary">本次摄入</div>
                      <NutritionDetailGrid profile={entry.totals} />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-primary">每 100g 基准</div>
                      <NutritionDetailGrid profile={entry.per100g} />
                    </div>
                  </div>
                ) : null}
              </div>
              
              <div className="flex items-center gap-1">
                {onEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(entry)}
                    className="opacity-0 group-hover:opacity-100 text-primary hover:bg-primary/10 transition-all rounded-full"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => onDelete(entry.id)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-all rounded-full"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
              );
            })()}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NutrientBadge({ label, value, unit, icon }: { label: string, value: any, unit: string, icon: React.ReactNode }) {
  // 转换为数字并进行安全检查
  const numValue = parseFloat(value);
  if (isNaN(numValue) || numValue === 0) return null;
  
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <div className="flex items-center gap-1 text-primary text-xs">
        {icon}
        <span className="font-bold">{numValue.toFixed(1)}{unit}</span>
      </div>
    </div>
  );
}
