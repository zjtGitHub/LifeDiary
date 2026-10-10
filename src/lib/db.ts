import Dexie, { type Table } from "dexie";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { decodeStockBackup, encodeStockBackup, type StockBackupData } from "./stock-backup";
import type {
  CalendarDayStatus,
  DayEntry,
  DiaryImage,
  ISODate,
  MonthlyReflection,
  MonthSummary,
  Profile,
  SearchResult,
  Stock,
  StockNote,
  StockNoteImage,
  StockNoteRevision,
  TodoItem,
  WeekSummary
} from "../types";

const now = () => new Date().toISOString();

const createId = () => {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class DiaryDatabase extends Dexie {
  dayEntries!: Table<DayEntry, ISODate>;
  todos!: Table<TodoItem, string>;
  profile!: Table<Profile, "me">;
  monthlyReflections!: Table<MonthlyReflection, string>;
  stocks!: Table<Stock, string>;
  stockNotes!: Table<StockNote, string>;
  stockRevisions!: Table<StockNoteRevision, string>;
  stockImages!: Table<StockNoteImage, string>;

  constructor(name = "riji-db") {
    super(name);
    this.version(1).stores({
      dayEntries: "&date, updatedAt",
      todos: "&id, date, completed, updatedAt",
      profile: "&id"
    });
    this.version(2).stores({ monthlyReflections: "&month, updatedAt" });
    this.version(3).stores({
      stocks: "&id, &[market+code], archivedAt",
      stockNotes: "&id, stockId, [stockId+updatedAt]",
      stockRevisions: "&id, noteId, stockId, [stockId+occurredAt], [stockId+publishedAt], &[noteId+revisionNumber]",
      stockImages: "&id"
    });
  }
}

export const db = new DiaryDatabase();

export const emptyDayEntry = (date: ISODate): DayEntry => ({
  date,
  text: "",
  tags: [],
  images: [],
  updatedAt: now()
});

const normalizeTags = (tags: string[]): string[] => {
  const seen = new Set<string>();

  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 16);
};

const normalizeDayEntry = (entry: DayEntry): DayEntry => ({
  ...emptyDayEntry(entry.date),
  ...entry,
  tags: normalizeTags(entry.tags ?? []),
  images: entry.images ?? []
});

export const getProfile = async (): Promise<Profile> => {
  const profile = await db.profile.get("me");
  return profile ?? { id: "me" };
};

export const saveBirthDate = async (birthDate: ISODate): Promise<Profile> => {
  const profile: Profile = { id: "me", birthDate };
  await db.profile.put(profile);
  return profile;
};

export const getDayEntry = async (date: ISODate): Promise<DayEntry> => {
  const entry = await db.dayEntries.get(date);
  return entry ? normalizeDayEntry(entry) : emptyDayEntry(date);
};

export const saveDayText = async (date: ISODate, text: string): Promise<DayEntry> => {
  const current = await getDayEntry(date);
  const entry: DayEntry = {
    ...current,
    text,
    updatedAt: now()
  };
  await db.dayEntries.put(entry);
  return entry;
};

export const saveDayTags = async (date: ISODate, tags: string[]): Promise<DayEntry> => {
  const current = await getDayEntry(date);
  const entry: DayEntry = {
    ...current,
    tags: normalizeTags(tags),
    updatedAt: now()
  };
  await db.dayEntries.put(entry);
  return entry;
};

export const addImagesToDay = async (date: ISODate, files: File[]): Promise<DayEntry> => {
  const current = await getDayEntry(date);
  const createdAt = now();
  const images: DiaryImage[] = files.map((file) => ({
    id: createId(),
    name: file.name,
    type: file.type,
    blob: file,
    createdAt
  }));
  const entry: DayEntry = {
    ...current,
    images: [...current.images, ...images],
    updatedAt: now()
  };
  await db.dayEntries.put(entry);
  return entry;
};

export const deleteImageFromDay = async (date: ISODate, imageId: string): Promise<DayEntry> => {
  const current = await getDayEntry(date);
  const entry: DayEntry = {
    ...current,
    images: current.images.filter((image) => image.id !== imageId),
    updatedAt: now()
  };
  await db.dayEntries.put(entry);
  return entry;
};

export const listTodosByDate = async (date: ISODate): Promise<TodoItem[]> => {
  const todos = await db.todos.where("date").equals(date).sortBy("createdAt");
  return todos;
};

export const addTodo = async (date: ISODate, title: string): Promise<TodoItem> => {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Todo title is required");
  }

  const timestamp = now();
  const todo: TodoItem = {
    id: createId(),
    date,
    title: trimmed,
    completed: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db.todos.add(todo);
  return todo;
};

export const setTodoCompleted = async (id: string, completed: boolean): Promise<void> => {
  await db.todos.update(id, {
    completed,
    updatedAt: now()
  });
};

export const deleteTodo = async (id: string): Promise<void> => {
  await db.todos.delete(id);
};

export const listCalendarStatuses = async (): Promise<Record<ISODate, CalendarDayStatus>> => {
  const [entries, todos] = await Promise.all([db.dayEntries.toArray(), db.todos.toArray()]);
  const statuses: Record<ISODate, CalendarDayStatus> = {};

  const ensureStatus = (date: ISODate): CalendarDayStatus => {
    statuses[date] ??= {
      hasDiary: false,
      hasImages: false,
      todoCount: 0,
      openTodoCount: 0,
      tags: []
    };
    return statuses[date];
  };

  entries.map(normalizeDayEntry).forEach((entry) => {
    const status = ensureStatus(entry.date);
    status.hasDiary = entry.text.trim().length > 0 || entry.tags.length > 0;
    status.hasImages = entry.images.length > 0;
    status.tags = entry.tags;
  });

  todos.forEach((todo) => {
    const status = ensureStatus(todo.date);
    status.todoCount += 1;
    if (!todo.completed) {
      status.openTodoCount += 1;
    }
  });

  return statuses;
};

export const listAllTags = async (): Promise<string[]> => {
  const entries = await db.dayEntries.toArray();
  const tags = entries.flatMap((entry) => normalizeDayEntry(entry).tags);
  return normalizeTags(tags).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
};

export const searchEntries = async (query: string): Promise<SearchResult[]> => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const tagQuery = normalizedQuery.startsWith("#") ? normalizedQuery.slice(1) : "";
  const [entries, todos] = await Promise.all([db.dayEntries.toArray(), db.todos.toArray()]);
  const todoCounts = new Map<ISODate, { total: number; open: number }>();

  todos.forEach((todo) => {
    const count = todoCounts.get(todo.date) ?? { total: 0, open: 0 };
    count.total += 1;
    if (!todo.completed) {
      count.open += 1;
    }
    todoCounts.set(todo.date, count);
  });

  return entries
    .map(normalizeDayEntry)
    .filter((entry) => entry.text.trim() || entry.tags.length > 0 || entry.images.length > 0)
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }

      const tags = entry.tags.map((tag) => tag.toLocaleLowerCase());
      if (tagQuery) {
        return tags.includes(tagQuery);
      }

      return (
        entry.date.includes(normalizedQuery) ||
        entry.text.toLocaleLowerCase().includes(normalizedQuery) ||
        tags.some((tag) => tag.includes(normalizedQuery))
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
    .map((entry) => {
      const counts = todoCounts.get(entry.date) ?? { total: 0, open: 0 };
      return {
        date: entry.date,
        text: entry.text,
        tags: entry.tags,
        imageCount: entry.images.length,
        todoCount: counts.total,
        openTodoCount: counts.open,
        updatedAt: entry.updatedAt
      };
    });
};

export const getWeekSummary = async (startDate: ISODate, endDate: ISODate): Promise<WeekSummary> => {
  const dates = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }).map((date) =>
    format(date, "yyyy-MM-dd")
  );
  const days = await Promise.all(
    dates.map(async (date) => {
      const [entry, todos] = await Promise.all([getDayEntry(date), listTodosByDate(date)]);
      return {
        date,
        text: entry.text,
        tags: entry.tags,
        imageCount: entry.images.length,
        todos
      };
    })
  );

  return {
    startDate,
    endDate,
    days,
    diaryDays: days.filter((day) => day.text.trim() || day.tags.length > 0).length,
    imageCount: days.reduce((sum, day) => sum + day.imageCount, 0),
    todoCount: days.reduce((sum, day) => sum + day.todos.length, 0),
    openTodoCount: days.reduce((sum, day) => sum + day.todos.filter((todo) => !todo.completed).length, 0)
  };
};

export const saveMonthlyReflection = async (month: string, text: string): Promise<void> => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid month");
  }
  await db.monthlyReflections.put({ month, text, updatedAt: now() });
};

export const getYearMonthSummaries = async (year: number): Promise<MonthSummary[]> => {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const [entries, todos, reflections] = await Promise.all([
    db.dayEntries.where("date").between(start, end, true, true).toArray(),
    db.todos.where("date").between(start, end, true, true).toArray(),
    db.monthlyReflections.where("month").between(`${year}-01`, `${year}-12`, true, true).toArray()
  ]);
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const monthEntries = entries.filter((entry) => entry.date.startsWith(`${month}-`)).map(normalizeDayEntry);
    const monthTodos = todos.filter((todo) => todo.date.startsWith(`${month}-`));
    return {
      month,
      reflection: reflections.find((item) => item.month === month)?.text ?? "",
      diaryDays: monthEntries.filter((entry) => entry.text.trim() || entry.tags.length > 0).length,
      imageCount: monthEntries.reduce((sum, entry) => sum + entry.images.length, 0),
      todoCount: monthTodos.length,
      completedTodoCount: monthTodos.filter((todo) => todo.completed).length,
      tags: Array.from(new Set(monthEntries.flatMap((entry) => entry.tags))),
      recordedDates: Array.from(new Set([
        ...monthEntries.filter((entry) => entry.text.trim() || entry.tags.length || entry.images.length).map((entry) => entry.date),
        ...monthTodos.map((todo) => todo.date)
      ])).sort()
    };
  });
};

interface BackupImage {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  createdAt: string;
}

interface BackupDayEntry {
  date: ISODate;
  text: string;
  tags: string[];
  images: BackupImage[];
  updatedAt: string;
}

export interface BackupPayload {
  app: "riji";
  version: 1;
  exportedAt: string;
  profile: Profile;
  dayEntries: BackupDayEntry[];
  todos: TodoItem[];
  monthlyReflections?: MonthlyReflection[];
  stockMemo?: StockBackupData;
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  if (typeof dataUrl !== "string" || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl)) throw new Error("Invalid backup image");
  const response = await fetch(dataUrl);
  return response.blob();
};

export const createBackupPayload = async (): Promise<BackupPayload> => {
  const [profile, entries, todos, monthlyReflections, stocks, notes, revisions, images] = await db.transaction("r", db.tables, () => Promise.all([
    getProfile(), db.dayEntries.toArray(), db.todos.toArray(), db.monthlyReflections.toArray(),
    db.stocks.toArray(), db.stockNotes.toArray(), db.stockRevisions.toArray(), db.stockImages.toArray()
  ]));
  const stockMemo = await encodeStockBackup({ stocks, notes, revisions, images });
  const dayEntries = await Promise.all(
    entries.map(async (rawEntry) => {
      const entry = normalizeDayEntry(rawEntry);
      const images = await Promise.all(
        entry.images.map(async (image) => ({
          id: image.id,
          name: image.name,
          type: image.type,
          dataUrl: await blobToDataUrl(image.blob),
          createdAt: image.createdAt
        }))
      );

      return {
        date: entry.date,
        text: entry.text,
        tags: entry.tags,
        images,
        updatedAt: entry.updatedAt
      };
    })
  );

  return {
    app: "riji",
    version: 1,
    exportedAt: now(),
    profile,
    dayEntries,
    todos,
    monthlyReflections,
    stockMemo
  };
};

export const restoreBackupPayload = async (payload: BackupPayload): Promise<void> => {
  if (!payload || payload.app !== "riji" || payload.version !== 1) {
    throw new Error("Unsupported backup file");
  }
  const stockData = decodeStockBackup(payload.stockMemo);

  const monthlyReflections = payload.monthlyReflections ?? [];
  if (!Array.isArray(monthlyReflections) || monthlyReflections.some((item) =>
    !item || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) || typeof item.text !== "string" || typeof item.updatedAt !== "string"
  )) {
    throw new Error("Invalid monthly reflections");
  }

  const dayEntries = await Promise.all(
    payload.dayEntries.map(async (entry) => ({
      date: entry.date,
      text: entry.text ?? "",
      tags: normalizeTags(entry.tags ?? []),
      images: await Promise.all(
        (entry.images ?? []).map(async (image) => ({
          id: image.id,
          name: image.name,
          type: image.type,
          blob: await dataUrlToBlob(image.dataUrl),
          createdAt: image.createdAt
        }))
      ),
      updatedAt: entry.updatedAt ?? now()
    }))
  );

  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()));
    await db.profile.put(payload.profile ?? { id: "me" });
    if (dayEntries.length > 0) {
      await db.dayEntries.bulkPut(dayEntries);
    }
    if (payload.todos.length > 0) {
      await db.todos.bulkPut(payload.todos);
    }
    if (monthlyReflections.length > 0) {
      await db.monthlyReflections.bulkPut(monthlyReflections);
    }
    await db.stocks.bulkPut(stockData.stocks);
    await db.stockNotes.bulkPut(stockData.notes);
    await db.stockRevisions.bulkPut(stockData.revisions);
    await db.stockImages.bulkPut(stockData.images);
  });
};
