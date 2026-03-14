'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Scale, Zap, Wheat, Beaker, Citrus, Bone, Activity } from 'lucide-react';
import { type FoodLogEntry } from './types';

interface FoodLogListProps {
  entries: FoodLogEntry[];
  onDelete: (id: string) => void;
}

export function FoodLogList({ entries, onDelete }: FoodLogListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 px-4 bg-white/30 rounded-2xl border-2 border-dashed border-muted-foreground/20">
        <p className="text-muted-foreground">今天还没有记录任何食物</p>
        <p className="text-xs text-muted-foreground/60 mt-1">开始输入您的饮食，让 AI 帮您计算全面营养素</p>
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
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <h4 className="font-bold text-lg text-primary">{entry.foodName}</h4>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Scale className="h-3 w-3" />
                    {entry.quantityDescription || '未知分量'} ({entry.estimatedGrams || 0}g)
                  </span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4">
                  <NutrientBadge label="蛋白质" value={entry.proteinGrams} unit="g" icon={<Zap className="h-3 w-3 fill-current" />} />
                  <NutrientBadge label="碳水" value={entry.carbohydrateGrams} unit="g" icon={<Wheat className="h-3 w-3" />} />
                  <NutrientBadge label="镁" value={entry.magnesiumMg} unit="mg" icon={<Beaker className="h-3 w-3" />} />
                  <NutrientBadge label="维C" value={entry.vitaminCMg} unit="mg" icon={<Citrus className="h-3 w-3" />} />
                  <NutrientBadge label="钙" value={entry.calciumMg} unit="mg" icon={<Bone className="h-3 w-3" />} />
                  <NutrientBadge label="铁" value={entry.ironMg} unit="mg" icon={<Activity className="h-3 w-3" />} />
                </div>
              </div>
              
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => onDelete(entry.id)}
                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-all rounded-full"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
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
