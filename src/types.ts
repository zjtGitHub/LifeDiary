export type ISODate = string;

export interface DiaryImage {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: string;
}

export interface DayHealth {
  weightKg?: number;
  calorieDeficitKcal?: number;
}

export interface DayEntry extends DayHealth {
  date: ISODate;
  text: string;
  tags: string[];
  images: DiaryImage[];
  updatedAt: string;
}

export interface TodoItem {
  id: string;
  date: ISODate;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  checklistItemId?: string;
  time?: string;
  endTime?: string;
}

export interface ChecklistSchedule {
  date: ISODate;
  time?: string;
  endTime?: string;
  repeat: "none" | "daily" | "workdays" | "weekends" | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "ebbinghaus" | "custom";
  interval?: number;
  unit?: "day" | "week" | "month" | "year";
  weekdays?: number[];
  until?: ISODate;
}

export interface ChecklistOccurrence {
  itemId: string;
  date: ISODate;
  completed: boolean;
  updatedAt: string;
}

export interface ChecklistGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  groupId: string;
  title: string;
  notes: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  schedule?: ChecklistSchedule | null;
}

export interface Profile {
  id: "me";
  birthDate?: ISODate;
}

export interface CalendarDayStatus extends DayHealth {
  hasDiary: boolean;
  hasImages: boolean;
  todoCount: number;
  openTodoCount: number;
  tags: string[];
  portfolioSnapshotId?: string;
  portfolioNav?: number;
  portfolioCurrency?: string;
}

export interface SearchResult extends DayHealth {
  date: ISODate;
  text: string;
  tags: string[];
  imageCount: number;
  todoCount: number;
  openTodoCount: number;
  updatedAt: string;
}

export interface WeekSummaryDay {
  date: ISODate;
  text: string;
  tags: string[];
  imageCount: number;
  todos: TodoItem[];
}

export interface WeekSummary {
  startDate: ISODate;
  endDate: ISODate;
  days: WeekSummaryDay[];
  diaryDays: number;
  imageCount: number;
  todoCount: number;
  openTodoCount: number;
}

export interface MonthlyReflection {
  month: string;
  text: string;
  updatedAt: string;
}

export interface MonthSummary {
  month: string;
  reflection: string;
  diaryDays: number;
  imageCount: number;
  todoCount: number;
  completedTodoCount: number;
  tags: string[];
  recordedDates: ISODate[];
}

export interface Stock {
  id: string;
  name: string;
  market: string;
  code?: string;
  pinned: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StockNoteType = "想法" | "事件" | "操作" | "复盘";
export type StockStance = "未判断" | "偏乐观" | "中性" | "偏谨慎";
export interface StockImageRef { id: string; caption: string }
export interface StockNoteContent {
  occurredAt: string;
  title: string;
  text: string;
  type: StockNoteType;
  isKeyNode: boolean;
  stance: StockStance;
  tags: string[];
  images: StockImageRef[];
  reviewOfNoteId: string | null;
}
export interface StockNote {
  id: string;
  stockId: string;
  draft: StockNoteContent | null;
  currentRevisionId: string | null;
  firstPublishedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface StockNoteRevision extends StockNoteContent {
  id: string;
  noteId: string;
  stockId: string;
  revisionNumber: number;
  publishedAt: string;
  deleted: boolean;
}
export interface StockNoteImage {
  id: string;
  blob: Blob;
  thumbnail: Blob;
  name: string;
  createdAt: string;
}
export interface StockTimelineItem {
  note: StockNote;
  revision: StockNoteRevision;
  versionCount: number;
}

export interface PortfolioAccountSnapshot {
  nav: number;
  cash: number;
  leverage: number;
  buyingPower?: number;
  availableFunds?: number;
}

export interface PortfolioStockPositionSnapshot {
  symbol: string;
  quantity: number;
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  portfolioWeightPct: number;
  unrealizedPnl: number;
  dailyPnl?: number;
}

export interface PortfolioOptionLegSnapshot {
  optionType: "CALL" | "PUT";
  side: "LONG" | "SHORT";
  strike: number;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
}

export type PortfolioOptionStrategyType = "single_call" | "single_put" | "bull_call_vertical" | "bear_call_vertical" | "bull_put_vertical" | "bear_put_vertical" | "covered_call" | "cash_secured_put" | "custom";

export interface PortfolioOptionStrategySnapshot {
  id: string;
  symbol: string;
  strategy: PortfolioOptionStrategyType;
  expiration: ISODate;
  quantity: number;
  averageNetDebit: number;
  totalCostBasis: number;
  marketValue: number;
  portfolioWeightPct: number;
  unrealizedPnl: number;
  legs: PortfolioOptionLegSnapshot[];
}

export interface PortfolioSnapshot {
  id: string;
  snapshotDate: ISODate;
  snapshotTime: string;
  broker: string;
  currency: string;
  account: PortfolioAccountSnapshot;
  stocks: PortfolioStockPositionSnapshot[];
  optionStrategies: PortfolioOptionStrategySnapshot[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}
