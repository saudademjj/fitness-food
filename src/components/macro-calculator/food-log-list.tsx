'use client';

import React, {useState} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Droplets,
  Flame,
  Pencil,
  Scale,
  Trash2,
  UtensilsCrossed,
  Wheat,
  Zap,
} from 'lucide-react';

import {NutritionDetailGrid} from '@/components/macro-calculator/nutrition-detail-grid';
import type {FoodLogEntry} from '@/components/macro-calculator/types';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {
  formatValidationFlag,
  getMatchModeLabel,
  getReliabilityMeta,
  getReviewerLabel,
  getSourceKindLabel,
} from '@/lib/source-meta';

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
    if (badgeClass.includes(key)) {
      return color;
    }
  }

  return 'bg-muted-foreground/30';
}

function ReviewMetaSummary({
  reviewMeta,
}: {
  reviewMeta: FoodLogEntry['reviewMeta'];
}) {
  if (!reviewMeta) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-card/70 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/5 text-primary">
          {reviewMeta.summaryLabel}
        </Badge>
        <span className="text-muted-foreground">
          {reviewMeta.successfulReviewerCount}/{reviewMeta.reviewerCount} 个模型返回
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {reviewMeta.votes.map((vote) => (
          <Badge
            key={vote.provider}
            variant="outline"
            className={`rounded-full ${
              vote.supportsConsensus
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {vote.providerLabel} · {vote.supportsConsensus ? '支持' : '保留'} ·{' '}
            {Math.round(vote.agreementScore * 100)}
          </Badge>
        ))}
        {reviewMeta.failedProviders.map((provider) => (
          <Badge
            key={provider}
            variant="outline"
            className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
          >
            {getReviewerLabel(provider)} · 未返回
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ValidationFlagBadges({flags}: {flags: FoodLogEntry['validationFlags']}) {
  if (!flags.length) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge
          key={flag}
          variant="outline"
          className="rounded-full border-amber-200 text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mr-1 h-2.5 w-2.5" />
          {formatValidationFlag(flag)}
        </Badge>
      ))}
    </div>
  );
}

function NutrientMiniBar({
  barColor,
  icon,
  label,
  status,
  unit,
  value,
}: {
  barColor: string;
  icon: React.ReactNode;
  label: string;
  status: 'measured' | 'estimated' | 'partial' | 'missing';
  unit: string;
  value: number | null;
}) {
  if (value === null || value === 0) {
    return null;
  }

  const maxVisual = unit === 'kcal' ? 800 : 60;
  const percent = Math.min((value / maxVisual) * 100, 100);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        <span className="font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-500`}
            style={{width: `${percent}%`}}
          />
        </div>
        <span className="whitespace-nowrap text-[10px] font-bold tabular-nums text-foreground">
          {status === 'partial' ? '>=' : ''}
          {value.toFixed(1)}
          <span className="ml-0.5 font-normal text-muted-foreground">{unit}</span>
        </span>
      </div>
    </div>
  );
}

function FoodLogCard({
  entry,
  isExpanded,
  onDelete,
  onEdit,
  onToggleExpanded,
}: {
  entry: FoodLogEntry;
  isExpanded: boolean;
  onDelete: (id: string) => void;
  onEdit?: (entry: FoodLogEntry) => void;
  onToggleExpanded: () => void;
}) {
  const reliability = getReliabilityMeta(entry);

  return (
    <Card className="group overflow-hidden border-none shadow-sm transition-all duration-300 hover:shadow-md">
      <div className="flex">
        <div className={`w-1 shrink-0 ${getBarColor(reliability.badgeClass)}`} />
        <CardContent className="flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h4 className="text-lg font-bold text-foreground">{entry.foodName}</h4>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={`rounded-full font-medium ${reliability.badgeClass}`}
                >
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
              <div className="mt-2 text-xs text-muted-foreground">{entry.sourceLabel}</div>
              <ReviewMetaSummary reviewMeta={entry.reviewMeta} />

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

              <ValidationFlagBadges flags={entry.validationFlags} />

              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleExpanded}
                  className="h-7 rounded-full px-2 text-xs text-muted-foreground hover:text-primary"
                >
                  {isExpanded ? (
                    <>
                      收起详情 <ChevronUp className="ml-1 h-3 w-3" />
                    </>
                  ) : (
                    <>
                      展开 23 项营养 <ChevronDown className="ml-1 h-3 w-3" />
                    </>
                  )}
                </Button>
              </div>

              {isExpanded ? (
                <div className="mt-3 animate-slide-expand">
                  <NutritionDetailGrid profile={entry.totals} meta={entry.totalsMeta} />
                </div>
              ) : null}
            </div>

            <div className="shrink-0">
              <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                {entry.estimatedGrams}g
              </div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {onEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                    onClick={() => onEdit(entry)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
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
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

export function FoodLogList({
  entries,
  onDelete,
  onEdit,
  listTitle = '今日记录',
  emptyTitle = '今天还没有记录任何食物',
  emptyDescription = '开始输入饮食描述，系统会优先命中营养数据库，复杂描述再交给主模型处理。',
}: FoodLogListProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  if (!entries.length) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-card/50 px-4 py-16 text-center dark:bg-card/30">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/60">
          <UtensilsCrossed className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <p className="font-medium text-muted-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground/60">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 px-1 text-lg font-semibold font-headline">
        {listTitle}
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {entries.length} 项
        </span>
      </h3>
      {entries.map((entry) => (
        <FoodLogCard
          key={entry.id}
          entry={entry}
          isExpanded={Boolean(expandedIds[entry.id])}
          onDelete={onDelete}
          onEdit={onEdit}
          onToggleExpanded={() =>
            setExpandedIds((current) => ({
              ...current,
              [entry.id]: !current[entry.id],
            }))
          }
        />
      ))}
    </div>
  );
}
