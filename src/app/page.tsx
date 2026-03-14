'use client';

import React, { useState, useEffect } from 'react';
import { DashboardSummary } from '@/components/macro-calculator/dashboard-summary';
import { FoodInputForm } from '@/components/macro-calculator/food-input-form';
import { FoodLogList } from '@/components/macro-calculator/food-log-list';
import { ConfirmationDialog } from '@/components/macro-calculator/confirmation-dialog';
import { type FoodLogEntry, type MacroGoals } from '@/components/macro-calculator/types';
import { type ParseFoodDescriptionOutput } from '@/ai/flows/parse-food-description-flow';
import { Salad, Settings2 } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

const DEFAULT_GOALS: MacroGoals = {
  energyKcal: 2000,
  proteinGrams: 120,
  fatGrams: 65,
  carbohydrateGrams: 225,
  fiberGrams: 30,
  sugarsGrams: 50,
  sodiumMg: 2300,
  potassiumMg: 4700,
  calciumMg: 1000,
  magnesiumMg: 400,
  ironMg: 18,
  zincMg: 11,
  vitaminAMcg: 900,
  vitaminCMg: 90,
  vitaminDMcg: 15,
  vitaminEMg: 15,
  vitaminKMcg: 120,
  thiaminMg: 1.2,
  riboflavinMg: 1.3,
  niacinMg: 16,
  vitaminB6Mg: 1.7,
  vitaminB12Mcg: 2.4,
  folateMcg: 400,
};

export default function MacroHelperPage() {
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const [goals, setGoals] = useState<MacroGoals>(DEFAULT_GOALS);
  const [parsedFoods, setParsedFoods] = useState<ParseFoodDescriptionOutput>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('macro_helper_entries_v2');
    const savedGoals = localStorage.getItem('macro_helper_goals_v2');
    if (saved) {
      try {
        setEntries(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load entries", e);
      }
    }
    if (savedGoals) {
      try {
        setGoals(JSON.parse(savedGoals));
      } catch (e) {
        console.error("Failed to load goals", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('macro_helper_entries_v2', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem('macro_helper_goals_v2', JSON.stringify(goals));
  }, [goals]);

  const totals = entries.reduce((acc, curr) => {
    Object.keys(DEFAULT_GOALS).forEach((key) => {
      const k = key as keyof MacroGoals;
      const val = Number(curr[k]);
      acc[k] = (acc[k] || 0) + (isNaN(val) ? 0 : val);
    });
    return acc;
  }, {} as Record<keyof MacroGoals, number>);

  const handleFoodsParsed = (foods: ParseFoodDescriptionOutput) => {
    setParsedFoods(foods);
    setIsConfirmOpen(true);
  };

  const handleConfirmAdd = (foods: ParseFoodDescriptionOutput) => {
    const newEntries: FoodLogEntry[] = foods.map(f => ({
      ...f,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }));
    setEntries(prev => [...prev, ...newEntries]);
    setIsConfirmOpen(false);
  };

  const handleDeleteEntry = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const updateGoal = (key: keyof MacroGoals, value: string) => {
    const num = parseFloat(value) || 0;
    setGoals(prev => ({ ...prev, [key]: num }));
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-10 w-full bg-white/70 backdrop-blur-md border-b border-secondary/20 py-4 px-6 mb-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-primary p-1.5 rounded-lg shadow-inner">
              <Salad className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-headline font-black text-primary tracking-tight">宏量助手 Pro</h1>
          </div>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="text-primary hover:bg-secondary rounded-full">
                <Settings2 className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <ScrollArea className="h-[400px] p-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium leading-none">目标设定</h4>
                    <p className="text-xs text-muted-foreground">配置每日所有 23 项营养素目标。</p>
                  </div>
                  <div className="grid gap-3">
                    {Object.keys(DEFAULT_GOALS).map((key) => (
                      <div key={key} className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor={`goal-${key}`} className="text-[10px] capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                        <Input
                          id={`goal-${key}`}
                          type="number"
                          step="0.1"
                          value={goals[key as keyof MacroGoals]}
                          onChange={(e) => updateGoal(key as keyof MacroGoals, e.target.value)}
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6">
        <DashboardSummary totals={totals} goals={goals} />

        <div className="max-w-3xl mx-auto">
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
