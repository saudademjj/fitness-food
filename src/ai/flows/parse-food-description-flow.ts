
'use server';
/**
 * @fileOverview This file implements a Genkit flow for parsing natural language food descriptions with high precision.
 *
 * - parseFoodDescription - A function that parses a natural language description of food into a comprehensive 23-nutrient data structure.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ParseFoodDescriptionInputSchema = z.object({
  description: z
    .string()
    .describe('A natural language description of food consumed, e.g., "一块煎牛排和两棵西兰花".'),
});
export type ParseFoodDescriptionInput = z.infer<typeof ParseFoodDescriptionInputSchema>;

const ParseFoodDescriptionOutputSchema = z.array(
  z.object({
    foodName: z.string().describe('The name of the food item.'),
    quantityDescription: z.string().describe('The quantity described, e.g., "150克".'),
    estimatedGrams: z.number().describe('Estimated total weight in grams.'),
    
    // Macros
    energyKcal: z.number().describe('Energy in kcal.'),
    proteinGrams: z.number().describe('Protein in grams.'),
    fatGrams: z.number().describe('Total fat in grams.'),
    carbohydrateGrams: z.number().describe('Total carbohydrates in grams.'),
    fiberGrams: z.number().describe('Dietary fiber in grams.'),
    sugarsGrams: z.number().describe('Total sugars in grams.'),
    
    // Minerals
    sodiumMg: z.number().describe('Sodium in mg.'),
    potassiumMg: z.number().describe('Potassium in mg.'),
    calciumMg: z.number().describe('Calcium in mg.'),
    magnesiumMg: z.number().describe('Magnesium in mg.'),
    ironMg: z.number().describe('Iron in mg.'),
    zincMg: z.number().describe('Zinc in mg.'),
    
    // Vitamins
    vitaminAMcg: z.number().describe('Vitamin A in mcg RAE.'),
    vitaminCMg: z.number().describe('Vitamin C in mg.'),
    vitaminDMcg: z.number().describe('Vitamin D in mcg.'),
    vitaminEMg: z.number().describe('Vitamin E in mg.'),
    vitaminKMcg: z.number().describe('Vitamin K in mcg.'),
    thiaminMg: z.number().describe('Vitamin B1 (Thiamin) in mg.'),
    riboflavinMg: z.number().describe('Vitamin B2 (Riboflavin) in mg.'),
    niacinMg: z.number().describe('Vitamin B3 (Niacin) in mg.'),
    vitaminB6Mg: z.number().describe('Vitamin B6 in mg.'),
    vitaminB12Mcg: z.number().describe('Vitamin B12 in mcg.'),
    folateMcg: z.number().describe('Folate in mcg DFE.'),
  })
);
export type ParseFoodDescriptionOutput = z.infer<typeof ParseFoodDescriptionOutputSchema>;

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  return parseFoodDescriptionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'parseFoodDescriptionPrompt',
  input: {schema: ParseFoodDescriptionInputSchema},
  output: {schema: ParseFoodDescriptionOutputSchema},
  prompt: `你是一位顶级临床营养师。你的任务是基于最新的公共食物营养数据库（如USDA或中国食物成分表）对用户提供的自然语言描述进行高精度的营养分析。

分析规则：
1. **精确估计**：根据描述中的食物量（如“一个中等大小的苹果”约182g，“一碗白米饭”约200g）计算所有23项指标。
2. **全面覆盖**：必须提供所有宏量营养素、关键矿物质和全谱维生素（A, C, D, E, K, B族, 叶酸）。
3. **数据可靠性**：如果描述不全，基于该食物的标准平均值进行科学估算。
4. **单位严格**：能量单位为kcal，宏量为克(g)，微量为毫克(mg)或微克(mcg)，请严格遵守Schema定义的单位。

用户输入: "{{{description}}}"
输出要求：返回一个 JSON 数组，每个元素代表一个识别到的食物项。`,
});

const parseFoodDescriptionFlow = ai.defineFlow(
  {
    name: 'parseFoodDescriptionFlow',
    inputSchema: ParseFoodDescriptionInputSchema,
    outputSchema: ParseFoodDescriptionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
