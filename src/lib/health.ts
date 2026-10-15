import type { DayHealth } from "../types";

export const healthLabels = ({ weightKg, calorieDeficitKcal }: DayHealth): string[] => [
  ...(weightKg !== undefined ? [`体重 ${weightKg * 2} 斤`] : []),
  ...(calorieDeficitKcal !== undefined ? [`缺口 ${calorieDeficitKcal} 大卡`] : [])
];
