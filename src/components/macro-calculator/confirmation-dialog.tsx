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
import {Droplets, Flame, Scale, Wheat, Zap} from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  parsedFoods: ParseFoodDescriptionOutput;
  onConfirm: (foods: ParseFoodDescriptionOutput) => void;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  parsedFoods,
  onConfirm,
}: ConfirmationDialogProps) {
  const [editedFoods, setEditedFoods] = useState<ParseFoodDescriptionOutput>([]);

  useEffect(() => {
    setEditedFoods(parsedFoods);
  }, [parsedFoods]);

  const handleWeightUpdate = (index: number, grams: number) => {
    const updated = [...editedFoods];
    updated[index] = updateFoodWeight(updated[index], grams);
    setEditedFoods(updated);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-headline font-bold text-primary">
            确认食物与重量
          </DialogTitle>
          <DialogDescription>
            先确认 AI 识别结果，再调节克重。四项营养会根据每100g数据实时重算。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[520px] px-6 py-4">
          <div className="space-y-6">
            {editedFoods.map((food, idx) => (
              <div
                key={`${food.foodName}-${idx}`}
                className="space-y-4 rounded-2xl border border-secondary/20 bg-secondary/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      食物名称
                    </Label>
                    <div className="text-lg font-bold text-primary">{food.foodName}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-full">
                        {food.sourceLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        置信度 {Math.round(food.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      原始描述：{food.quantityDescription || '未知分量'}
                    </p>
                  </div>

                  <div className="min-w-[180px] space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      当前重量 (g)
                    </Label>
                    <Input
                      type="number"
                      value={food.estimatedGrams}
                      onChange={(e) => handleWeightUpdate(idx, parseFloat(e.target.value) || 0)}
                      className="bg-white"
                    />
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
                      value: `${food.totals.energyKcal.toFixed(1)} kcal`,
                      icon: <Flame className="h-3 w-3" />,
                    },
                    {
                      label: '蛋白质',
                      value: `${food.totals.proteinGrams.toFixed(1)} g`,
                      icon: <Zap className="h-3 w-3" />,
                    },
                    {
                      label: '碳水',
                      value: `${food.totals.carbohydrateGrams.toFixed(1)} g`,
                      icon: <Wheat className="h-3 w-3" />,
                    },
                    {
                      label: '脂肪',
                      value: `${food.totals.fatGrams.toFixed(1)} g`,
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

                <p className="text-[10px] text-muted-foreground italic">
                  每100g基准：{food.per100g.energyKcal.toFixed(1)} kcal / 蛋白{' '}
                  {food.per100g.proteinGrams.toFixed(1)}g / 碳水{' '}
                  {food.per100g.carbohydrateGrams.toFixed(1)}g / 脂肪{' '}
                  {food.per100g.fatGrams.toFixed(1)}g
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t p-6 pt-2 gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} className="rounded-full">
            取消
          </Button>
          <Button
            onClick={() => onConfirm(editedFoods)}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            确认并添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
