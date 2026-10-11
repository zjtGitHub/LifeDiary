export type ISODate = string;

export interface DiaryImage {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: string;
}

export interface DayEntry {
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
}

export interface Profile {
  id: "me";
  birthDate?: ISODate;
}

export interface CalendarDayStatus {
  hasDiary: boolean;
  hasImages: boolean;
  todoCount: number;
  openTodoCount: number;
  tags: string[];
}

export interface SearchResult {
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
