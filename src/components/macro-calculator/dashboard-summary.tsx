'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Wheat, Beaker, Citrus, Dumbbell, Bone, Flame, Droplets, Leaf, Activity } from 'lucide-react';
import { type MacroGoals } from './types';

interface DashboardSummaryProps {
  totals: Partial<Record<keyof MacroGoals, number>>;
  goals: MacroGoals;
}

export function DashboardSummary({ totals, goals }: DashboardSummaryProps) {
  const getProgress = (current: number | undefined, goal: number) => {
    if (!current || isNaN(current)) return 0;
    return Math.min((current / goal) * 100, 100);
  };

  const macroNutrients = [
    { label: '热量', key: 'energyKcal', goal: goals.energyKcal, unit: 'kcal', icon: <Flame className="h-4 w-4" />, color: 'bg-orange-500' },
    { label: '蛋白质', key: 'proteinGrams', goal: goals.proteinGrams, unit: 'g', icon: <Zap className="h-4 w-4" />, color: 'bg-primary' },
    { label: '碳水', key: 'carbohydrateGrams', goal: goals.carbohydrateGrams, unit: 'g', icon: <Wheat className="h-4 w-4" />, color: 'bg-accent' },
    { label: '脂肪', key: 'fatGrams', goal: goals.fatGrams, unit: 'g', icon: <Droplets className="h-4 w-4" />, color: 'bg-yellow-500' },
    { label: '纤维', key: 'fiberGrams', goal: goals.fiberGrams, unit: 'g', icon: <Leaf className="h-4 w-4" />, color: 'bg-green-600' },
  ];

  const mineralNutrients = [
    { label: '钙', key: 'calciumMg', goal: goals.calciumMg, unit: 'mg', icon: <Bone className="h-4 w-4" />, color: 'bg-emerald-500' },
    { label: '镁', key: 'magnesiumMg', goal: goals.magnesiumMg, unit: 'mg', icon: <Beaker className="h-4 w-4" />, color: 'bg-blue-500' },
    { label: '铁', key: 'ironMg', goal: goals.ironMg, unit: 'mg', icon: <Dumbbell className="h-4 w-4" />, color: 'bg-red-500' },
    { label: '锌', key: 'zincMg', goal: goals.zincMg, unit: 'mg', icon: <Activity className="h-4 w-4" />, color: 'bg-purple-500' },
    { label: '钾', key: 'potassiumMg', goal: goals.potassiumMg, unit: 'mg', icon: <Activity className="h-4 w-4" />, color: 'bg-cyan-500' },
    { label: '钠', key: 'sodiumMg', goal: goals.sodiumMg, unit: 'mg', icon: <Activity className="h-4 w-4" />, color: 'bg-slate-400' },
  ];

  const vitaminNutrients = [
    { label: '维A', key: 'vitaminAMcg', goal: goals.vitaminAMcg, unit: 'mcg', icon: <Citrus className="h-4 w-4" />, color: 'bg-amber-500' },
    { label: '维C', key: 'vitaminCMg', goal: goals.vitaminCMg, unit: 'mg', icon: <Citrus className="h-4 w-4" />, color: 'bg-orange-400' },
    { label: '维D', key: 'vitaminDMcg', goal: goals.vitaminDMcg, unit: 'mcg', icon: <Citrus className="h-4 w-4" />, color: 'bg-yellow-400' },
    { label: '维E', key: 'vitaminEMg', goal: goals.vitaminEMg, unit: 'mg', icon: <Citrus className="h-4 w-4" />, color: 'bg-rose-400' },
    { label: '维B12', key: 'vitaminB12Mcg', goal: goals.vitaminB12Mcg, unit: 'mcg', icon: <Citrus className="h-4 w-4" />, color: 'bg-pink-500' },
    { label: '叶酸', key: 'folateMcg', goal: goals.folateMcg, unit: 'mcg', icon: <Leaf className="h-4 w-4" />, color: 'bg-lime-500' },
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
      <Tabs defaultValue="macros" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4 bg-secondary/30 rounded-xl">
          <TabsTrigger value="macros" className="text-xs">宏量/核心</TabsTrigger>
          <TabsTrigger value="minerals" className="text-xs">矿物质</TabsTrigger>
          <TabsTrigger value="vitamins" className="text-xs">维生素</TabsTrigger>
        </TabsList>
        <TabsContent value="macros">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {macroNutrients.map(renderNutrientCard)}
          </div>
        </TabsContent>
        <TabsContent value="minerals">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {mineralNutrients.map(renderNutrientCard)}
          </div>
        </TabsContent>
        <TabsContent value="vitamins">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {vitaminNutrients.map(renderNutrientCard)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
