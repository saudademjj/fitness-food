
'use client';

import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ParseFoodDescriptionOutput } from '@/ai/flows/parse-food-description-flow';
import { Scale, Zap, Wheat, Droplets, Flame, Activity } from 'lucide-react';

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
  onConfirm 
}: ConfirmationDialogProps) {
  const [editedFoods, setEditedFoods] = useState<ParseFoodDescriptionOutput>([]);

  useEffect(() => {
    setEditedFoods(parsedFoods);
  }, [parsedFoods]);

  const handleUpdate = (index: number, field: string, value: string | number) => {
    const updated = [...editedFoods];
    (updated[index] as any)[field] = value;
    setEditedFoods(updated);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-headline font-bold text-primary">确认 23 项营养数据</DialogTitle>
          <DialogDescription>
            AI 专家已为您解析出完整的营养成分表。
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[500px] px-6 py-4">
          <div className="space-y-8">
            {editedFoods.map((food, idx) => (
              <div key={idx} className="p-4 bg-secondary/10 rounded-2xl border border-secondary/20 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">食物名称</Label>
                    <Input 
                      value={food.foodName} 
                      onChange={(e) => handleUpdate(idx, 'foodName', e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">重量 (g)</Label>
                    <Input 
                      type="number" 
                      value={food.estimatedGrams} 
                      onChange={(e) => handleUpdate(idx, 'estimatedGrams', parseFloat(e.target.value) || 0)}
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {[
                    { label: '热量', key: 'energyKcal', icon: <Flame className="h-3 w-3" /> },
                    { label: '蛋白', key: 'proteinGrams', icon: <Zap className="h-3 w-3" /> },
                    { label: '碳水', key: 'carbohydrateGrams', icon: <Wheat className="h-3 w-3" /> },
                    { label: '脂肪', key: 'fatGrams', icon: <Droplets className="h-3 w-3" /> },
                    { label: '纤维', key: 'fiberGrams', icon: <Activity className="h-3 w-3" /> },
                    { label: '钙', key: 'calciumMg', icon: <Activity className="h-3 w-3" /> },
                    { label: '铁', key: 'ironMg', icon: <Activity className="h-3 w-3" /> },
                    { label: '锌', key: 'zincMg', icon: <Activity className="h-3 w-3" /> },
                  ].map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-[9px] flex items-center gap-1 font-bold text-muted-foreground">
                        {field.icon} {field.label}
                      </Label>
                      <Input 
                        type="number" 
                        step="0.1"
                        value={(food as any)[field.key]} 
                        onChange={(e) => handleUpdate(idx, field.key, parseFloat(e.target.value) || 0)}
                        className="bg-white h-7 text-xs px-2"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground italic">* 其他维生素等 15 项数据已在后台记录，如需全部修改请在详情页操作。</p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 pt-2 gap-2 sm:gap-0 border-t">
          <Button variant="outline" onClick={onClose} className="rounded-full">取消</Button>
          <Button 
            onClick={() => onConfirm(editedFoods)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
          >
            确认并添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
