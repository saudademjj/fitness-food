'use client';

import {Cloud, Download, History} from 'lucide-react';

import type {ViewerState} from '@/components/macro-calculator/types';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

type FoodHistoryToolbarProps = {
  onExport: (formatType: 'csv' | 'json') => Promise<void>;
  onSelectedDateChange: (value: string) => void;
  selectedDate: string;
  viewer: ViewerState;
};

export function FoodHistoryToolbar({
  onExport,
  onSelectedDateChange,
  selectedDate,
  viewer,
}: FoodHistoryToolbarProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/40 bg-card/60 px-4 py-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:bg-card/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="h-4 w-4" />
        <span>{viewer ? '云端历史' : '本地草稿'}</span>
        {viewer ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-primary">
            <Cloud className="h-3 w-3" />
            跨设备同步
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={selectedDate}
          onChange={(event) => onSelectedDateChange(event.target.value)}
          className="w-[160px] bg-card dark:bg-card/60"
        />
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => onExport('csv')}
          disabled={!viewer}
        >
          <Download className="mr-2 h-4 w-4" />
          导出 CSV
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => onExport('json')}
          disabled={!viewer}
        >
          <Download className="mr-2 h-4 w-4" />
          导出 JSON
        </Button>
      </div>
    </div>
  );
}
