import type { DayHealth } from "../types";

export const healthLabels = ({ weightKg, waistCm, calorieDeficitKcal }: DayHealth): string[] => [
  ...(weightKg !== undefined ? [`体重 ${weightKg * 2} 斤`] : []),
  ...(waistCm !== undefined ? [`腰围 ${waistCm} 厘米`] : []),
  ...(calorieDeficitKcal !== undefined ? [`缺口 ${calorieDeficitKcal} 大卡`] : [])
];
