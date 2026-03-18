'use client';

import React, {useEffect, useState} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Slider} from '@/components/ui/slider';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {updateFoodWeight} from './types';
import {AlertTriangle, Droplets, Flame, Loader2, Scale, Trash2, Wheat, Zap} from 'lucide-react';
import {NutritionDetailGrid} from '@/components/macro-calculator/nutrition-detail-grid';
import {getReliabilityMeta} from '@/lib/source-meta';
import {normalizeLookupText, sanitizeFoodName} from '@/lib/food-text';

type EditableFoodItem = ParseFoodDescriptionOutput['items'][number] & {
  __originalIndex: number;
};

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  parsedResult: ParseFoodDescriptionOutput;
  onConfirm: (payload: {
    foods: ParseFoodDescriptionOutput['items'];
    requiresReconciliation: boolean;
  }) => void;
  dialogTitle?: string;
  dialogDescription?: string;
  confirmLabel?: string;
  isSubmitting?: boolean;
}

function formatNutritionCardValue(value: number | null, status: 'measured' | 'estimated' | 'partial' | 'missing', unit: string) {
  if (value === null) {
    return `-- ${unit}`;
  }

  return `${status === 'partial' ? '>= ' : ''}${value.toFixed(1)} ${unit}`;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  parsedResult,
  onConfirm,
  dialogTitle = '确认食物与重量',
  dialogDescription = '先确认识别结果，再调节名称和克重。23 项营养会根据每 100g 数据实时重算。',
  confirmLabel = '确认并添加',
  isSubmitting = false,
}: ConfirmationDialogProps) {
  const [editedFoods, setEditedFoods] = useState<EditableFoodItem[]>([]);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);

  useEffect(() => {
    setEditedFoods(parsedResult.items.map((food, index) => ({...food, __originalIndex: index})));
    setRequiresReconciliation(false);
  }, [parsedResult]);

  useEffect(() => {
    setRequiresReconciliation(
      editedFoods.some((food) => {
        const originalFood = parsedResult.items[food.__originalIndex];
        return (
          normalizeLookupText(sanitizeFoodName(food.foodName)) !==
          normalizeLookupText(sanitizeFoodName(originalFood?.foodName ?? ''))
        );
      })
    );
  }, [editedFoods, parsedResult]);

  const handleWeightUpdate = (index: number, grams: number) => {
    const updated = [...editedFoods];
    updated[index] = updateFoodWeight(updated[index], grams);
    setEditedFoods(updated);
  };

  const handleNameUpdate = (index: number, foodName: string) => {
    const updated = [...editedFoods];
    updated[index] = {
      ...updated[index],
      foodName,
    };
    setEditedFoods(updated);
  };

  const handleDelete = (index: number) => {
    setEditedFoods((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-headline font-bold text-primary">
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[520px] px-6 py-4">
          <div className="space-y-6">
            {parsedResult.segments.map((segment, index) => (
              <div
                key={`${segment.sourceDescription}-${index}`}
                className="rounded-2xl border border-primary/10 bg-primary/[0.03] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-primary">
                      {segment.compositeDishName ?? segment.sourceDescription}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {segment.totalWeight}g · 置信度 {Math.round(segment.overallConfidence * 100)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-white px-3 py-2 text-xs">
                      热量 {segment.totalNutrition.energyKcal?.toFixed(1) ?? '--'} kcal
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 text-xs">
                      蛋白 {segment.totalNutrition.proteinGrams?.toFixed(1) ?? '--'} g
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 text-xs">
                      碳水 {segment.totalNutrition.carbohydrateGrams?.toFixed(1) ?? '--'} g
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 text-xs">
                      脂肪 {segment.totalNutrition.fatGrams?.toFixed(1) ?? '--'} g
                    </div>
                  </div>
                </div>
                {segment.ingredientBreakdown.length > 0 ? (
                  <details className="mt-3 rounded-xl border border-border/70 bg-white/80 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      展开原料明细
                    </summary>
                    <div className="mt-3 space-y-2">
                      {segment.ingredientBreakdown.map((ingredient, ingredientIndex) => (
                        <div
                          key={`${ingredient.foodName}-${ingredientIndex}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/20 px-3 py-2 text-xs"
                        >
                          <div className="font-medium text-primary">
                            {ingredient.foodName}
                          </div>
                          <div className="text-muted-foreground">
                            {ingredient.estimatedGrams}g · {ingredient.sourceLabel}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
            {editedFoods.map((food, idx) => {
              const reliability = getReliabilityMeta(food);
              return (
              <div
                key={`${food.foodName}-${idx}`}
                className="space-y-4 rounded-2xl border border-secondary/20 bg-secondary/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      食物名称
                    </Label>
                    <Input
                      value={food.foodName}
                      onChange={(e) => handleNameUpdate(idx, e.target.value)}
                      className="bg-white text-lg font-bold text-primary"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`rounded-full ${reliability.badgeClass}`}
                      >
                        {reliability.label}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {food.sourceLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        置信度 {Math.round(food.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      原始描述：{food.quantityDescription || '未知分量'}
                    </p>
                    {food.sourceKind === 'ai_fallback' ? (
                      <div className={`rounded-xl border px-3 py-2 text-xs ${reliability.hintClass}`}>
                        <div className="flex items-center gap-1 font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {reliability.label}
                        </div>
                        <p className="mt-1">{reliability.description}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-[180px] space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      当前重量 (g)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={food.estimatedGrams}
                        onChange={(e) => handleWeightUpdate(idx, parseFloat(e.target.value) || 0)}
                        className="bg-white"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(idx)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Scale className="h-3 w-3" />
                      调整克重
                    </span>
                    <span>{food.estimatedGrams}g</span>
                  </div>
                  <Slider
                    min={0}
                    max={Math.max(300, Math.ceil(food.estimatedGrams * 2))}
                    step={5}
                    value={[food.estimatedGrams]}
                    onValueChange={([value]) => handleWeightUpdate(idx, value ?? 0)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      label: '热量',
                      value: formatNutritionCardValue(
                        food.totals.energyKcal,
                        food.totalsMeta.energyKcal.status,
                        'kcal'
                      ),
                      icon: <Flame className="h-3 w-3" />,
                    },
                    {
                      label: '蛋白质',
                      value: formatNutritionCardValue(
                        food.totals.proteinGrams,
                        food.totalsMeta.proteinGrams.status,
                        'g'
                      ),
                      icon: <Zap className="h-3 w-3" />,
                    },
                    {
                      label: '碳水',
                      value: formatNutritionCardValue(
                        food.totals.carbohydrateGrams,
                        food.totalsMeta.carbohydrateGrams.status,
                        'g'
                      ),
                      icon: <Wheat className="h-3 w-3" />,
                    },
                    {
                      label: '脂肪',
                      value: formatNutritionCardValue(
                        food.totals.fatGrams,
                        food.totalsMeta.fatGrams.status,
                        'g'
                      ),
                      icon: <Droplets className="h-3 w-3" />,
                    },
                  ].map((field) => (
                    <div key={field.label} className="rounded-xl bg-white p-3 shadow-sm">
                      <Label className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                        {field.icon}
                        {field.label}
                      </Label>
                      <div className="mt-1 text-sm font-semibold text-primary">
                        {field.value}
                      </div>
                    </div>
                  ))}
                </div>

                <details className="rounded-xl border border-border/70 bg-white/70 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    查看 23 项营养详情
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="mb-2 text-xs font-semibold text-primary">本次摄入</div>
                      <NutritionDetailGrid profile={food.totals} meta={food.totalsMeta} />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-primary">每 100g 基准</div>
                      <NutritionDetailGrid profile={food.per100g} meta={food.per100gMeta} />
                    </div>
                  </div>
                </details>
              </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t p-6 pt-2 gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} className="rounded-full">
            取消
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                foods: editedFoods
                  .filter((food) => food.foodName.trim())
                  .map(({__originalIndex: _originalIndex, ...food}) => food),
                requiresReconciliation,
              })
            }
            disabled={!editedFoods.length || isSubmitting}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在保存...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
