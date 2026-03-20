'use client';

import {Cloud, LogIn, Salad, Settings2} from 'lucide-react';

import {
  GOAL_FIELD_GROUPS,
  type MacroGoals,
  type ViewerState,
} from '@/components/macro-calculator/types';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';

type MacroHelperHeaderProps = {
  authConfigured: boolean;
  goals: MacroGoals;
  loginEmail: string;
  onGoalChange: (key: keyof MacroGoals, value: string) => void;
  onLoginEmailChange: (value: string) => void;
  onLogout: () => Promise<void>;
  onRequestMagicLink: () => Promise<void>;
  viewer: ViewerState;
};

export function MacroHelperHeader({
  authConfigured,
  goals,
  loginEmail,
  onGoalChange,
  onLoginEmailChange,
  onLogout,
  onRequestMagicLink,
  viewer,
}: MacroHelperHeaderProps) {
  return (
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
                  <Button variant="outline" onClick={onLogout} className="w-full rounded-full">
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
                    onChange={(event) => onLoginEmailChange(event.target.value)}
                  />
                  <Button
                    onClick={onRequestMagicLink}
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
                              onChange={(event) =>
                                onGoalChange(field.key, event.target.value)
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
  );
}
