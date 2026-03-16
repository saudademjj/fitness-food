'use client';

import React, {useEffect, useState} from 'react';
import {DashboardSummary} from '@/components/macro-calculator/dashboard-summary';
import {FoodInputForm} from '@/components/macro-calculator/food-input-form';
import {FoodLogList} from '@/components/macro-calculator/food-log-list';
import {ConfirmationDialog} from '@/components/macro-calculator/confirmation-dialog';
import {
  createEntryId,
  DEFAULT_GOALS,
  ENTRY_STORAGE_KEY,
  GOAL_STORAGE_KEY,
  isFoodLogEntryArray,
  isMacroGoals,
  sumEntryTotals,
  type FoodLogEntry,
  type MacroGoals,
} from '@/components/macro-calculator/types';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {Salad, Settings2} from 'lucide-react';
import {Toaster} from '@/components/ui/toaster';
import {Button} from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ScrollArea} from '@/components/ui/scroll-area';

const GOAL_LABELS: Record<keyof MacroGoals, string> = {
  energyKcal: '热量',
  proteinGrams: '蛋白质',
  fatGrams: '脂肪',
  carbohydrateGrams: '碳水',
};

export default function MacroHelperPage() {
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const [goals, setGoals] = useState<MacroGoals>(DEFAULT_GOALS);
  const [parsedFoods, setParsedFoods] = useState<ParseFoodDescriptionOutput>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    const savedEntries = localStorage.getItem(ENTRY_STORAGE_KEY);
    const savedGoals = localStorage.getItem(GOAL_STORAGE_KEY);

    if (savedEntries) {
      try {
        const parsed = JSON.parse(savedEntries);
        if (isFoodLogEntryArray(parsed)) {
          setEntries(parsed);
        }
      } catch (error) {
        console.error('Failed to load entries', error);
      }
    }

    if (savedGoals) {
      try {
        const parsed = JSON.parse(savedGoals);
        if (isMacroGoals(parsed)) {
          setGoals(parsed);
        }
      } catch (error) {
        console.error('Failed to load goals', error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goals));
  }, [goals]);

  const totals = sumEntryTotals(entries);

  const handleFoodsParsed = (foods: ParseFoodDescriptionOutput) => {
    setParsedFoods(foods);
    setIsConfirmOpen(true);
  };

  const handleConfirmAdd = (foods: ParseFoodDescriptionOutput) => {
    const newEntries: FoodLogEntry[] = foods.map((food) => ({
      ...food,
      id: createEntryId(),
      timestamp: Date.now(),
    }));

    setEntries((prev) => [...prev, ...newEntries]);
    setIsConfirmOpen(false);
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const updateGoal = (key: keyof MacroGoals, value: string) => {
    const nextValue = parseFloat(value) || 0;
    setGoals((prev) => ({...prev, [key]: nextValue}));
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-10 mb-6 w-full border-b border-secondary/20 bg-white/70 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary p-1.5 shadow-inner">
              <Salad className="h-6 w-6 text-white" />
            </div>
            <h1 className="font-headline text-2xl font-black tracking-tight text-primary">
              宏量助手 Pro
            </h1>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-primary hover:bg-secondary"
              >
                <Settings2 className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <ScrollArea className="h-[320px] p-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium leading-none">目标设定</h4>
                    <p className="text-xs text-muted-foreground">
                      配置每日四项核心营养目标。
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {Object.keys(DEFAULT_GOALS).map((key) => (
                      <div key={key} className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor={`goal-${key}`} className="text-[10px]">
                          {GOAL_LABELS[key as keyof MacroGoals]}
                        </Label>
                        <Input
                          id={`goal-${key}`}
                          type="number"
                          step="0.1"
                          value={goals[key as keyof MacroGoals]}
                          onChange={(e) =>
                            updateGoal(key as keyof MacroGoals, e.target.value)
                          }
                          className="col-span-2 h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        <DashboardSummary totals={totals} goals={goals} />

        <div className="mx-auto max-w-3xl">
          <FoodInputForm onFoodsParsed={handleFoodsParsed} />

          <div className="mt-8">
            <FoodLogList
              entries={entries.slice().sort((a, b) => b.timestamp - a.timestamp)}
              onDelete={handleDeleteEntry}
            />
          </div>
        </div>
      </main>

      <ConfirmationDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        parsedFoods={parsedFoods}
        onConfirm={handleConfirmAdd}
      />

      <Toaster />
    </div>
  );
}
