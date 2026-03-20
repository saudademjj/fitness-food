'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  ParseFoodDescriptionOutputSchema,
  type ParseFoodDescriptionOutput,
} from '@/lib/food-contract';

interface FoodInputFormProps {
  onFoodsParsed: (payload: {
    result: ParseFoodDescriptionOutput;
    description: string;
  }) => void;
}

export function FoodInputForm({ onFoodsParsed }: FoodInputFormProps) {
  const [description, setDescription] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const { toast } = useToast();

  const requestParse = async (input: string): Promise<ParseFoodDescriptionOutput> => {
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ description: input }),
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error('页面刚刚更新，请刷新页面后再试一次。');
    }

    const payload = (await response.json()) as
      | ParseFoodDescriptionOutput
      | {error?: string};

    if (!response.ok) {
      throw new Error(
        typeof payload === 'object' && payload && 'error' in payload && payload.error
          ? payload.error
          : '解析服务暂时不可用，请稍后再试。'
      );
    }

    return ParseFoodDescriptionOutputSchema.parse(payload);
  };

  const handleParse = async () => {
    if (!description.trim()) return;

    setIsParsing(true);
    try {
      const results = await requestParse(description);
      if (results && results.items.length > 0) {
        onFoodsParsed({
          result: results,
          description,
        });
        setDescription('');
      } else {
        toast({
          title: "未能识别",
          description: "抱歉，没能从您的描述中解析出食物。请尝试更具体一些。",
          variant: "destructive",
        });
      }
    } catch (error) {
      const description = (() => {
        if (!(error instanceof Error)) {
          return "连接AI服务时出现错误，请稍后再试。";
        }

        const message = error.message.trim();
        if (
          message.includes('unexpected response') ||
          message.includes('Failed to find Server Action')
        ) {
          return '页面刚刚更新，请刷新页面后再试一次。';
        }

        return message || "连接AI服务时出现错误，请稍后再试。";
      })();

      toast({
        title: "解析失败",
        description,
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <Card className="border-none shadow-md mb-8 overflow-hidden animate-fade-in-up">
      {/* Gradient top border decoration */}
      <div className="h-1 w-full bg-gradient-to-r from-primary via-accent to-primary" />
      <CardHeader className="pb-3">
        <CardTitle className="text-xl flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          食物录入
        </CardTitle>
        <CardDescription>
          用自然语言描述您吃了什么。系统会先尝试直接命中营养数据库，复杂描述再交给主模型拆解和估算。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <Textarea
            placeholder="今天吃了什么？"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[100px] bg-secondary/30 border-none focus-visible:ring-accent transition-transform duration-200 focus:scale-[1.01]"
          />
          <Button
            onClick={handleParse}
            disabled={isParsing || !description.trim()}
            className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary text-primary-foreground font-semibold py-6 rounded-xl shadow-md transition-all active:scale-95 hover:shadow-lg"
          >
            {isParsing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在智能解析中...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                记录美味
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground/60">
            试试：一碗米饭、两个煎蛋、一杯牛奶
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
