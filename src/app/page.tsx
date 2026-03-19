'use client';

import React, {useEffect, useState} from 'react';
import {DashboardSummary} from '@/components/macro-calculator/dashboard-summary';
import {FoodInputForm} from '@/components/macro-calculator/food-input-form';
import {FoodLogList} from '@/components/macro-calculator/food-log-list';
import {ConfirmationDialog} from '@/components/macro-calculator/confirmation-dialog';
import {
  GOAL_FIELD_GROUPS,
  coerceFoodLogEntryArray,
  coerceMacroGoals,
  createEntryId,
  DEFAULT_GOALS,
  ENTRY_STORAGE_KEY,
  GOAL_STORAGE_KEY,
  MIGRATION_STORAGE_KEY,
  sumEntryTotals,
  type FoodLogEntry,
  type MacroGoals,
} from '@/components/macro-calculator/types';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {Salad, Settings2, LogIn, Download, History, Cloud} from 'lucide-react';
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
import {useToast} from '@/hooks/use-toast';
import {
  getViewerAction,
  logoutAction,
  requestMagicLinkAction,
} from '@/app/actions/auth';
import {
  deleteFoodLogItemAction,
  exportFoodLogsAction,
  listFoodLogEntriesAction,
  migrateLocalEntriesAction,
  resolveEditedFoodsAction,
  saveParsedFoodsAction,
  updateFoodLogItemAction,
} from '@/app/actions/logs';
import {
  buildTimestampForDateKey,
  formatLocalDateKey,
  getDateKeyFromTimestamp,
} from '@/lib/log-date';

const TODAY = formatLocalDateKey(new Date());

type ViewerState = {
  id: string;
  email: string;
  displayName: string | null;
} | null;

export default function MacroHelperPage() {
  const [localEntries, setLocalEntries] = useState<FoodLogEntry[]>([]);
  const [serverEntries, setServerEntries] = useState<FoodLogEntry[]>([]);
  const [goals, setGoals] = useState<MacroGoals>(DEFAULT_GOALS);
  const [parsedResult, setParsedResult] = useState<ParseFoodDescriptionOutput | null>(null);
  const [pendingDescription, setPendingDescription] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FoodLogEntry | null>(null);
  const {toast} = useToast();
  const getEntryDateKey = (entry: Pick<FoodLogEntry, 'loggedOn' | 'timestamp'>) =>
    entry.loggedOn ?? getDateKeyFromTimestamp(entry.timestamp);

  const displayEntries = viewer
    ? serverEntries
    : localEntries.filter(
        (entry) => getEntryDateKey(entry) === selectedDate
      );
  const totals = sumEntryTotals(displayEntries);

  useEffect(() => {
    const savedEntries = localStorage.getItem(ENTRY_STORAGE_KEY);
    const savedGoals = localStorage.getItem(GOAL_STORAGE_KEY);

    if (savedEntries) {
      try {
        const parsed = JSON.parse(savedEntries);
        const coercedEntries = coerceFoodLogEntryArray(parsed);
        if (coercedEntries) {
          setLocalEntries(coercedEntries);
        }
      } catch (error) {
        console.error('Failed to load entries', error);
      }
    }

    if (savedGoals) {
      try {
        const parsed = JSON.parse(savedGoals);
        const coercedGoals = coerceMacroGoals(parsed);
        if (coercedGoals) {
          setGoals(coercedGoals);
        }
      } catch (error) {
        console.error('Failed to load goals', error);
      }
    }

    const loadViewer = async () => {
      try {
        const result = await getViewerAction();
        setViewer(result.viewer);
        setAuthConfigured(result.authConfigured);
      } catch (error) {
        console.error('Failed to load viewer', error);
      }
    };

    void loadViewer();
  }, []);

  useEffect(() => {
    localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(localEntries));
  }, [localEntries]);

  useEffect(() => {
    localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    const authState = new URLSearchParams(window.location.search).get('auth');
    if (authState === 'success') {
      toast({
        title: '登录成功',
        description: '已切换到云端同步模式。',
      });
      window.history.replaceState({}, '', '/');
      void refreshViewer();
    } else if (authState === 'invalid') {
      toast({
        title: '登录链接无效',
        description: '链接已过期或已被使用，请重新获取。',
        variant: 'destructive',
      });
      window.history.replaceState({}, '', '/');
    }
  }, [toast]);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    void loadServerEntries(selectedDate);
  }, [viewer, selectedDate]);

  useEffect(() => {
    if (!viewer || !localEntries.length) {
      return;
    }

    const alreadyMigrated = localStorage.getItem(MIGRATION_STORAGE_KEY) === '1';
    if (alreadyMigrated) {
      return;
    }

    const migrateDrafts = async () => {
      try {
        const migrated = await migrateLocalEntriesAction(localEntries);
        localStorage.setItem(MIGRATION_STORAGE_KEY, '1');
        setLocalEntries([]);
        toast({
          title: '本地草稿已迁移',
          description: `已同步 ${migrated} 条历史记录到云端。`,
        });
        await loadServerEntries(selectedDate);
      } catch (error) {
        console.error(error);
      }
    };

    void migrateDrafts();
  }, [viewer, localEntries, selectedDate, toast]);

  const refreshViewer = async () => {
    const result = await getViewerAction();
    setViewer(result.viewer);
    setAuthConfigured(result.authConfigured);
  };

  const loadServerEntries = async (date: string) => {
    setIsLoadingEntries(true);
    try {
      const entries = await listFoodLogEntriesAction(date);
      setServerEntries(entries);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : '读取历史记录失败，请稍后再试。';
      toast({
        title: '加载历史失败',
        description,
        variant: 'destructive',
      });
    } finally {
      setIsLoadingEntries(false);
    }
  };

  const handleFoodsParsed = (payload: {
    result: ParseFoodDescriptionOutput;
    description: string;
  }) => {
    setParsedResult(payload.result);
    setPendingDescription(payload.description);
    setEditingEntry(null);
    setIsConfirmOpen(true);
  };

  const handleConfirmFoods = async ({
    foods,
    requiresReconciliation,
  }: {
    foods: ParseFoodDescriptionOutput['items'];
    requiresReconciliation: boolean;
  }) => {
    setIsConfirming(true);
    try {
      const resolvedFoods = requiresReconciliation
        ? await resolveEditedFoodsAction(foods)
        : foods;
      if (editingEntry) {
        const updated = await updateFoodLogItemAction(editingEntry.id, resolvedFoods[0]!);
        if (viewer) {
          setServerEntries((current) =>
            current.map((entry) => (entry.id === editingEntry.id ? updated : entry))
          );
        } else {
          setLocalEntries((current) =>
            current.map((entry) =>
              entry.id === editingEntry.id
                ? {
                    ...entry,
                    ...resolvedFoods[0],
                  }
                : entry
            )
          );
        }
        toast({
          title: '已更新食物记录',
          description: '名称与重量已重新校验并保存。',
        });
      } else if (viewer) {
        const eatenAt = buildTimestampForDateKey(selectedDate);
        const created = await saveParsedFoodsAction(
          resolvedFoods,
          pendingDescription,
          eatenAt,
          selectedDate
        );
        setServerEntries((current) => [...created, ...current].sort((a, b) => b.timestamp - a.timestamp));
        toast({
          title: '已同步到云端',
          description: '这次记录已经保存到你的账号历史中。',
        });
      } else {
        const timestamp = buildTimestampForDateKey(selectedDate);
        const draftBatchId = createEntryId();
        const newEntries: FoodLogEntry[] = resolvedFoods.map((food) => ({
          ...food,
          id: createEntryId(),
          timestamp,
          loggedOn: selectedDate,
          draftBatchId,
        }));
        setLocalEntries((prev) => [...newEntries, ...prev]);
        toast({
          title: '已保存到本地草稿',
          description: '登录后会自动迁移到云端历史。',
        });
      }

      setIsConfirmOpen(false);
      setParsedResult(null);
      setPendingDescription('');
      setEditingEntry(null);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : '保存食物记录失败，请稍后再试。';
      toast({
        title: '保存失败',
        description,
        variant: 'destructive',
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      if (viewer) {
        await deleteFoodLogItemAction(id);
        setServerEntries((current) => current.filter((entry) => entry.id !== id));
      } else {
        setLocalEntries((current) => current.filter((entry) => entry.id !== id));
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : '删除失败，请稍后再试。';
      toast({
        title: '删除失败',
        description,
        variant: 'destructive',
      });
    }
  };

  const handleEditEntry = (entry: FoodLogEntry) => {
    setEditingEntry(entry);
    const item = {
      foodName: entry.foodName,
      quantityDescription: entry.quantityDescription,
      estimatedGrams: entry.estimatedGrams,
      confidence: entry.confidence,
      sourceKind: entry.sourceKind,
      sourceLabel: entry.sourceLabel,
      matchMode: entry.matchMode,
      sourceStatus: entry.sourceStatus,
      amountBasisG: entry.amountBasisG,
      validationFlags: entry.validationFlags,
      per100g: entry.per100g,
      per100gMeta: entry.per100gMeta,
      totals: entry.totals,
      totalsMeta: entry.totalsMeta,
    };
    setParsedResult({
      compositeDishName: null,
      totalNutrition: entry.totals,
      totalNutritionMeta: entry.totalsMeta,
      totalWeight: entry.estimatedGrams,
      overallConfidence: entry.confidence,
      items: [item],
      segments: [
        {
          sourceDescription: entry.foodName,
          compositeDishName: null,
          resolutionKind: 'direct_items',
          totalNutrition: entry.totals,
          totalNutritionMeta: entry.totalsMeta,
          totalWeight: entry.estimatedGrams,
          overallConfidence: entry.confidence,
          items: [item],
          ingredientBreakdown: [],
        },
      ],
    });
    setPendingDescription(entry.foodName);
    setIsConfirmOpen(true);
  };

  const updateGoal = (key: keyof MacroGoals, value: string) => {
    const nextValue = parseFloat(value) || 0;
    setGoals((prev) => ({...prev, [key]: nextValue}));
  };

  const handleRequestMagicLink = async () => {
    try {
      await requestMagicLinkAction(loginEmail);
      toast({
        title: '登录链接已发送',
        description: '请检查邮箱并点击链接完成登录。',
      });
      setLoginEmail('');
    } catch (error) {
      const description =
        error instanceof Error ? error.message : '发送登录链接失败，请稍后再试。';
      toast({
        title: '发送失败',
        description,
        variant: 'destructive',
      });
    }
  };

  const handleLogout = async () => {
    await logoutAction();
    setViewer(null);
    setServerEntries([]);
    toast({
      title: '已退出登录',
      description: '当前切换回本地草稿模式。',
    });
  };

  const handleExport = async (formatType: 'csv' | 'json') => {
    try {
      const file = await exportFoodLogsAction(formatType, selectedDate);
      const blob = new Blob([file.content], {type: file.mimeType});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : '导出失败，请稍后再试。';
      toast({
        title: '导出失败',
        description,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-10 mb-6 w-full border-b border-border/40 bg-background/80 px-6 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-primary to-primary/80 p-2 shadow-md">
              <Salad className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-headline text-2xl font-black tracking-tight text-primary">
                营养助手 Pro
              </h1>
              <p className="text-xs text-muted-foreground">
                {viewer
                  ? `已登录 ${viewer.email} · 历史记录按日期同步`
                  : '未登录时保存为本地草稿，也支持按日期筛选；登录后会自动迁移到云端'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="rounded-full">
                  <LogIn className="mr-2 h-4 w-4" />
                  {viewer ? '账号' : '登录同步'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-3">
                {viewer ? (
                  <>
                    <div>
                      <div className="font-semibold text-primary">{viewer.email}</div>
                      <div className="text-xs text-muted-foreground">
                        登录后可编辑历史、跨设备同步和导出。
                      </div>
                    </div>
                    <Button variant="outline" onClick={handleLogout} className="w-full rounded-full">
                      退出登录
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="font-semibold text-primary">邮箱魔法链接登录</div>
                      <div className="text-xs text-muted-foreground">
                        输入邮箱后，我们会发送一个一次性登录链接。
                      </div>
                    </div>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                    <Button
                      onClick={handleRequestMagicLink}
                      className="w-full rounded-full"
                      disabled={!authConfigured || !loginEmail.trim()}
                    >
                      发送登录链接
                    </Button>
                    {!authConfigured ? (
                      <p className="text-xs text-amber-600">
                        服务器尚未配置 SMTP，暂时只能使用本地草稿。
                      </p>
                    ) : null}
                  </>
                )}
              </PopoverContent>
            </Popover>

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
                <ScrollArea className="h-[420px] p-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <h4 className="font-medium leading-none">目标设定</h4>
                      <p className="text-xs text-muted-foreground">
                        配置每日 23 项营养目标，钠和添加糖按上限展示。
                      </p>
                    </div>
                    {GOAL_FIELD_GROUPS.map((group) => (
                      <div key={group.id} className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </div>
                        <div className="grid gap-3">
                          {group.fields.map((field) => (
                            <div key={field.key} className="grid grid-cols-3 items-center gap-4">
                              <Label htmlFor={`goal-${field.key}`} className="text-[10px]">
                                {field.label}
                              </Label>
                              <Input
                                id={`goal-${field.key}`}
                                type="number"
                                step="0.1"
                                value={goals[field.key]}
                                onChange={(e) =>
                                  updateGoal(field.key, e.target.value)
                                }
                                className="col-span-2 h-8 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-2 sm:px-6">
        <DashboardSummary totals={totals.profile} totalsMeta={totals.meta} goals={goals} />

        <div className="mx-auto max-w-3xl">
          <FoodInputForm onFoodsParsed={handleFoodsParsed} />

          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/40 bg-card/60 dark:bg-card/30 px-4 py-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-[160px] bg-card dark:bg-card/60"
              />
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => handleExport('csv')}
                disabled={!viewer}
              >
                <Download className="mr-2 h-4 w-4" />
                导出 CSV
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => handleExport('json')}
                disabled={!viewer}
              >
                <Download className="mr-2 h-4 w-4" />
                导出 JSON
              </Button>
            </div>
          </div>

          {isLoadingEntries ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl bg-card/60 p-5">
                  <div className="h-5 w-1/3 rounded-lg animate-shimmer" />
                  <div className="mt-3 h-3 w-2/3 rounded-lg animate-shimmer" />
                  <div className="mt-2 h-3 w-1/2 rounded-lg animate-shimmer" />
                  <div className="mt-4 grid grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((j) => (
                      <div key={j} className="h-8 rounded-lg animate-shimmer" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <FoodLogList
              entries={displayEntries.slice().sort((a, b) => b.timestamp - a.timestamp)}
              onDelete={handleDeleteEntry}
              onEdit={handleEditEntry}
              listTitle={selectedDate === TODAY ? '今日记录' : `${selectedDate} 记录`}
              emptyTitle={viewer ? '这个日期还没有任何历史记录' : '这个日期还没有本地草稿'}
              emptyDescription={
                viewer
                  ? '换一个日期看看，或继续录入新的饮食描述。'
                  : '未登录时记录会保存在浏览器里，也支持按日期筛选；登录后会自动迁移到云端。'
              }
            />
          )}
        </div>
      </main>

      {parsedResult ? (
        <ConfirmationDialog
          isOpen={isConfirmOpen}
          onClose={() => {
            if (isConfirming) {
              return;
            }
            setIsConfirmOpen(false);
            setEditingEntry(null);
            setParsedResult(null);
          }}
          parsedResult={parsedResult}
          onConfirm={handleConfirmFoods}
          isSubmitting={isConfirming}
          dialogTitle={editingEntry ? '编辑历史记录' : '确认食物与重量'}
          dialogDescription={
            editingEntry
              ? '修改名称或克重后，系统会重新校验营养值并覆盖原记录。'
              : '先确认识别结果，再调节名称和克重。整菜总营养和原料明细都会一起展示。'
          }
          confirmLabel={editingEntry ? '保存修改' : viewer ? '确认并同步' : '确认并存为草稿'}
        />
      ) : null}

      <Toaster />

      <footer className="mt-16 border-t border-border/30 py-6 text-center text-xs text-muted-foreground/60">
        营养助手 Pro · 数据仅供参考，不构成医学建议
      </footer>
    </div>
  );
}
