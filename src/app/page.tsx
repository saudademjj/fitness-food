'use client';

import {useCallback, useEffect, useRef, useState} from 'react';

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
  reviewEditedFoodsAction,
  saveParsedFoodsAction,
  updateFoodLogItemAction,
} from '@/app/actions/logs';
import {ConfirmationDialog} from '@/components/macro-calculator/confirmation-dialog';
import {DashboardSummary} from '@/components/macro-calculator/dashboard-summary';
import {FoodHistoryToolbar} from '@/components/macro-calculator/food-history-toolbar';
import {FoodInputForm} from '@/components/macro-calculator/food-input-form';
import {FoodLogList} from '@/components/macro-calculator/food-log-list';
import {FoodLogListSkeleton} from '@/components/macro-calculator/food-log-list-skeleton';
import {MacroHelperHeader} from '@/components/macro-calculator/macro-helper-header';
import {
  DEFAULT_GOALS,
  ENTRY_STORAGE_KEY,
  GOAL_STORAGE_KEY,
  MIGRATION_STORAGE_KEY,
  coerceFoodLogEntryArray,
  coerceMacroGoals,
  createEntryId,
  sumEntryTotals,
  type FoodLogEntry,
  type MacroGoals,
  type ViewerState,
} from '@/components/macro-calculator/types';
import {Toaster} from '@/components/ui/toaster';
import {useToast} from '@/hooks/use-toast';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {
  buildTimestampForDateKey,
  getChineseDayOfWeek,
  getDateKeyFromTimestamp,
  getRelativeDateLabel,
  getTodayDateKey,
} from '@/lib/log-date';

function useTodayDateKey(): string {
  const [today, setToday] = useState(() => getTodayDateKey());
  const todayRef = useRef(today);
  todayRef.current = today;

  const check = useCallback(() => {
    const now = getTodayDateKey();
    if (now !== todayRef.current) {
      setToday(now);
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = setInterval(check, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    };
  }, [check]);

  return today;
}

type ConfirmationStage = 'editing' | 'reviewed';

function getEntryDateKey(entry: Pick<FoodLogEntry, 'loggedOn' | 'timestamp'>): string {
  return entry.loggedOn ?? getDateKeyFromTimestamp(entry.timestamp);
}

function buildEditableParseResult(entry: FoodLogEntry): ParseFoodDescriptionOutput {
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
    reviewMeta: entry.reviewMeta ?? null,
    per100g: entry.per100g,
    per100gMeta: entry.per100gMeta,
    totals: entry.totals,
    totalsMeta: entry.totalsMeta,
  };

  return {
    compositeDishName: null,
    totalNutrition: entry.totals,
    totalNutritionMeta: entry.totalsMeta,
    totalWeight: entry.estimatedGrams,
    overallConfidence: entry.confidence,
    items: [item],
    secondaryReviewSummary: null,
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
  };
}

function buildPendingDescription(entry: FoodLogEntry): string {
  return entry.quantityDescription && entry.quantityDescription !== '未知'
    ? `${entry.quantityDescription}${entry.foodName}`
    : entry.foodName;
}

export default function MacroHelperPage() {
  const today = useTodayDateKey();
  const [localEntries, setLocalEntries] = useState<FoodLogEntry[]>([]);
  const [serverEntries, setServerEntries] = useState<FoodLogEntry[]>([]);
  const [goals, setGoals] = useState<MacroGoals>(DEFAULT_GOALS);
  const [parsedResult, setParsedResult] = useState<ParseFoodDescriptionOutput | null>(null);
  const [pendingDescription, setPendingDescription] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => getTodayDateKey());
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FoodLogEntry | null>(null);
  const [confirmationStage, setConfirmationStage] =
    useState<ConfirmationStage>('reviewed');
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(false);
  const {toast} = useToast();

  const displayEntries = viewer
    ? serverEntries
    : localEntries.filter((entry) => getEntryDateKey(entry) === selectedDate);
  const sortedDisplayEntries = [...displayEntries].sort(
    (left, right) => right.timestamp - left.timestamp
  );
  const totals = sumEntryTotals(displayEntries);

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

  const resetConfirmationState = () => {
    setIsConfirmOpen(false);
    setParsedResult(null);
    setPendingDescription('');
    setEditingEntry(null);
    setConfirmationStage('reviewed');
  };

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

    setHasLoadedLocalState(true);
    void refreshViewer();
  }, []);

  useEffect(() => {
    if (!hasLoadedLocalState) {
      return;
    }

    localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(localEntries));
  }, [hasLoadedLocalState, localEntries]);

  useEffect(() => {
    if (!hasLoadedLocalState) {
      return;
    }

    localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goals));
  }, [goals, hasLoadedLocalState]);

  useEffect(() => {
    const authState = new URLSearchParams(window.location.search).get('auth');
    if (authState === 'success') {
      toast({
        title: '登录成功',
        description: '已切换到云端同步模式。',
      });
      window.history.replaceState({}, '', '/');
      void refreshViewer();
      return;
    }

    if (authState === 'invalid') {
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
  }, [selectedDate, viewer]);

  useEffect(() => {
    if (!viewer || !localEntries.length || !hasLoadedLocalState) {
      return;
    }

    if (localStorage.getItem(MIGRATION_STORAGE_KEY) === '1') {
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
  }, [hasLoadedLocalState, localEntries, selectedDate, toast, viewer]);

  const prevTodayRef = useRef(today);
  useEffect(() => {
    const prevToday = prevTodayRef.current;
    prevTodayRef.current = today;
    if (prevToday !== today && selectedDate === prevToday) {
      setSelectedDate(today);
    }
  }, [today, selectedDate]);

  const handleFoodsParsed = (payload: {
    result: ParseFoodDescriptionOutput;
    description: string;
  }) => {
    setParsedResult(payload.result);
    setPendingDescription(payload.description);
    setEditingEntry(null);
    setConfirmationStage('reviewed');
    setIsConfirmOpen(true);
  };

  const handleConfirmFoods = async ({
    foods,
    requiresReconciliation,
  }: {
    foods: ParseFoodDescriptionOutput['items'];
    requiresReconciliation: boolean;
  }) => {
    const firstFood = foods[0];
    if (!firstFood) {
      return;
    }

    setIsConfirming(true);
    try {
      if (requiresReconciliation) {
        const reviewedResult = await reviewEditedFoodsAction(foods, pendingDescription);
        const reviewFailed = reviewedResult.items.some((item) =>
          item.validationFlags.includes('ai_secondary_review_failed')
        );
        const reviewSummary = reviewedResult.secondaryReviewSummary;
        const reviewScore = reviewSummary
          ? `${reviewSummary.voteCount}/${reviewSummary.providerCount} 票 · 共识分 ${Math.round(
              reviewSummary.consensusScore * 100
            )}`
          : null;

        setParsedResult(reviewedResult);
        setConfirmationStage('reviewed');
        toast({
          title: reviewFailed ? '二次复核失败' : '已完成三模型复核',
          description: reviewFailed
            ? `当前保留的是复核前结果${
                reviewSummary
                  ? `，本轮 ${reviewSummary.successfulReviewerCount}/${reviewSummary.providerCount} 个模型返回。`
                  : '。'
              }请人工确认后再决定是否保存。`
            : reviewScore
              ? `${reviewScore}，请再确认一次复核后的重量与营养值。`
              : '请再确认一次复核后的重量与营养值。',
          variant: reviewFailed ? 'destructive' : undefined,
        });
        return;
      }

      if (editingEntry) {
        const updated = await updateFoodLogItemAction(editingEntry.id, firstFood);
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
                    ...firstFood,
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
          foods,
          pendingDescription,
          eatenAt,
          selectedDate
        );
        setServerEntries((current) =>
          [...created, ...current].sort((left, right) => right.timestamp - left.timestamp)
        );
        toast({
          title: '已同步到云端',
          description: '这次记录已经保存到你的账号历史中。',
        });
      } else {
        const timestamp = buildTimestampForDateKey(selectedDate);
        const draftBatchId = createEntryId();
        const newEntries: FoodLogEntry[] = foods.map((food) => ({
          ...food,
          id: createEntryId(),
          timestamp,
          loggedOn: selectedDate,
          draftBatchId,
        }));
        setLocalEntries((current) => [...newEntries, ...current]);
        toast({
          title: '已保存到本地草稿',
          description: '登录后会自动迁移到云端历史。',
        });
      }

      resetConfirmationState();
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
        return;
      }

      setLocalEntries((current) => current.filter((entry) => entry.id !== id));
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
    setParsedResult(buildEditableParseResult(entry));
    setPendingDescription(buildPendingDescription(entry));
    setConfirmationStage('reviewed');
    setIsConfirmOpen(true);
  };

  const updateGoal = (key: keyof MacroGoals, value: string) => {
    const nextValue = Number.parseFloat(value) || 0;
    setGoals((current) => ({...current, [key]: nextValue}));
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

  const confirmationDialogDescription =
    confirmationStage === 'editing'
      ? '你已经修改了名称或克重。系统会先调用主模型、MiniMax 和 DeepSeek 共同复核，再把最终结果回显给你。'
      : editingEntry
        ? '这是当前可保存的复核结果；如继续修改名称或克重，会再次进入三模型复核。'
        : parsedResult?.secondaryReviewSummary?.attempted
          ? '这是当前可保存的复核结果。直接确认即可保存，继续修改名称或克重会再次进入三模型复核。'
          : '这是首轮识别结果。直接确认即可保存；如继续修改名称或克重，系统会先调用三模型复核再回显。';

  const confirmLabel =
    confirmationStage === 'editing'
      ? editingEntry
        ? '先复核修改'
        : '先复核结果'
      : editingEntry
        ? '保存修改'
        : viewer
          ? '确认并同步'
          : '确认并存为草稿';

  const relativeLabel = getRelativeDateLabel(selectedDate, today);
  const dayOfWeek = getChineseDayOfWeek(selectedDate);
  const historyTitle = relativeLabel
    ? `${relativeLabel}记录`
    : `${selectedDate} ${dayOfWeek} 记录`;
  const historyEmptyTitle = viewer
    ? '这个日期还没有任何历史记录'
    : '这个日期还没有本地草稿';
  const historyEmptyDescription = viewer
    ? '换一个日期看看，或继续录入新的饮食描述。'
    : '未登录时记录会保存在浏览器里，也支持按日期筛选；登录后会自动迁移到云端。';

  return (
    <div className="min-h-screen bg-background pb-20">
      <MacroHelperHeader
        authConfigured={authConfigured}
        goals={goals}
        loginEmail={loginEmail}
        onGoalChange={updateGoal}
        onLoginEmailChange={setLoginEmail}
        onLogout={handleLogout}
        onRequestMagicLink={handleRequestMagicLink}
        viewer={viewer}
      />

      <main className="mx-auto max-w-4xl px-4 pt-2 sm:px-6">
        <DashboardSummary totals={totals.profile} totalsMeta={totals.meta} goals={goals} />

        <div className="mx-auto max-w-3xl">
          <FoodInputForm onFoodsParsed={handleFoodsParsed} />

          <FoodHistoryToolbar
            onExport={handleExport}
            onSelectedDateChange={setSelectedDate}
            selectedDate={selectedDate}
            today={today}
            viewer={viewer}
          />

          {isLoadingEntries ? (
            <FoodLogListSkeleton />
          ) : (
            <FoodLogList
              entries={sortedDisplayEntries}
              onDelete={handleDeleteEntry}
              onEdit={handleEditEntry}
              listTitle={historyTitle}
              emptyTitle={historyEmptyTitle}
              emptyDescription={historyEmptyDescription}
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
            resetConfirmationState();
          }}
          parsedResult={parsedResult}
          onConfirm={handleConfirmFoods}
          isSubmitting={isConfirming}
          onReviewStateChange={setConfirmationStage}
          dialogTitle={editingEntry ? '编辑历史记录' : '确认食物与重量'}
          dialogDescription={confirmationDialogDescription}
          confirmLabel={confirmLabel}
        />
      ) : null}

      <Toaster />

      <footer className="mt-16 border-t border-border/30 py-6 text-center text-xs text-muted-foreground/60">
        营养助手 Pro · 数据仅供参考，不构成医学建议
      </footer>
    </div>
  );
}
