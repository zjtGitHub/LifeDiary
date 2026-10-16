import Dexie, { type Table } from "dexie";
import { eachDayOfInterval, endOfMonth, format, parseISO } from "date-fns";
import { expandChecklistSchedules, isISODate, isValidSchedule, occursOn, parseOccurrenceId, sortPlans } from "./schedules";
import { decodeStockBackup, encodeStockBackup, type StockBackupData } from "./stock-backup";
import { validateStoredPortfolioSnapshot } from "./portfolio-data";
import type {
  CalendarDayStatus,
  ChecklistGroup,
  ChecklistItem,
  ChecklistOccurrence,
  DayEntry,
  DayHealth,
  DiaryImage,
  ISODate,
  MonthlyReflection,
  MonthSummary,
  PortfolioSnapshot,
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
  checklistGroups!: Table<ChecklistGroup, string>;
  checklistItems!: Table<ChecklistItem, string>;
  checklistOccurrences!: Table<ChecklistOccurrence, [string, ISODate]>;
  profile!: Table<Profile, "me">;
  monthlyReflections!: Table<MonthlyReflection, string>;
  stocks!: Table<Stock, string>;
  stockNotes!: Table<StockNote, string>;
  stockRevisions!: Table<StockNoteRevision, string>;
  stockImages!: Table<StockNoteImage, string>;
  portfolioSnapshots!: Table<PortfolioSnapshot, string>;

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
    this.version(4).stores({
      checklistGroups: "&id, createdAt",
      checklistItems: "&id, groupId, createdAt"
    });
    this.version(5).stores({ checklistOccurrences: "&[itemId+date], itemId, date" });
    this.version(6).stores({ portfolioSnapshots: "&id, snapshotDate, [snapshotDate+snapshotTime]" });
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

const updateDayEntry = (date: ISODate, update: (entry: DayEntry) => DayEntry): Promise<DayEntry> => db.transaction("rw", db.dayEntries, async () => {
  const current = await getDayEntry(date);
  const entry = { ...update(current), updatedAt: now() };
  await db.dayEntries.put(entry);
  return entry;
});

const isValidWeight = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isValidCalorieDeficit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const saveDayHealth = async (date: ISODate, health: DayHealth): Promise<DayEntry> => {
  if (!isISODate(date) || (health.weightKg !== undefined && !isValidWeight(health.weightKg)) ||
    (health.calorieDeficitKcal !== undefined && !isValidCalorieDeficit(health.calorieDeficitKcal))) {
    throw new Error("请检查体重和卡路里缺口，体重需大于 0，卡路里缺口需为有效数字");
  }
  return updateDayEntry(date, current => {
    const entry = { ...current };
    if (health.weightKg === undefined) delete entry.weightKg;
    else entry.weightKg = health.weightKg;
    if (health.calorieDeficitKcal === undefined) delete entry.calorieDeficitKcal;
    else entry.calorieDeficitKcal = health.calorieDeficitKcal;
    return entry;
  });
};

export const saveDayWeight = async (date: ISODate, weightKg?: number): Promise<DayEntry> => {
  if (!isISODate(date) || (weightKg !== undefined && !isValidWeight(weightKg))) throw new Error("请输入大于 0 的有效体重");
  return updateDayEntry(date, current => {
    const entry = { ...current };
    if (weightKg === undefined) delete entry.weightKg;
    else entry.weightKg = weightKg;
    return entry;
  });
};

export const saveDayText = (date: ISODate, text: string): Promise<DayEntry> => updateDayEntry(date, current => ({ ...current, text }));

export const saveDayTags = (date: ISODate, tags: string[]): Promise<DayEntry> => updateDayEntry(date, current => ({ ...current, tags: normalizeTags(tags) }));

export const addImagesToDay = async (date: ISODate, files: File[]): Promise<DayEntry> => {
  const createdAt = now();
  const images: DiaryImage[] = files.map((file) => ({
    id: createId(),
    name: file.name,
    type: file.type,
    blob: file,
    createdAt
  }));
  return updateDayEntry(date, current => ({ ...current, images: [...current.images, ...images] }));
};

export const deleteImageFromDay = (date: ISODate, imageId: string): Promise<DayEntry> => updateDayEntry(date, current => ({ ...current, images: current.images.filter(image => image.id !== imageId) }));

export const listTodosByDate = async (date: ISODate): Promise<TodoItem[]> => {
  const data = await getCalendarMonthData(date, date);
  return data.todos[date] ?? [];
};

export const savePortfolioSnapshot = async (snapshot: Omit<PortfolioSnapshot, "id" | "createdAt" | "updatedAt">, replaceDate = false): Promise<PortfolioSnapshot> => {
  const timestamp = now();
  const saved: PortfolioSnapshot = { ...snapshot, id: createId(), createdAt: timestamp, updatedAt: timestamp };
  await db.transaction("rw", db.portfolioSnapshots, async () => {
    if (replaceDate) {
      const existing = await db.portfolioSnapshots.where("snapshotDate").equals(snapshot.snapshotDate).primaryKeys();
      await db.portfolioSnapshots.bulkDelete(existing);
    }
    await db.portfolioSnapshots.add(saved);
  });
  return saved;
};

export const listPortfolioSnapshots = async (): Promise<PortfolioSnapshot[]> =>
  (await db.portfolioSnapshots.toArray()).sort((a, b) =>
    b.snapshotDate.localeCompare(a.snapshotDate) || b.snapshotTime.localeCompare(a.snapshotTime) || b.createdAt.localeCompare(a.createdAt)
  );

export const getPortfolioSnapshot = (id: string): Promise<PortfolioSnapshot | undefined> => db.portfolioSnapshots.get(id);

export const getCalendarMonthData = async (startDate: ISODate, endDate: ISODate) => {
  const [entries, todos, items, occurrences, snapshots] = await Promise.all([
    db.dayEntries.where("date").between(startDate, endDate, true, true).toArray(),
    db.todos.where("date").between(startDate, endDate, true, true).toArray(),
    db.checklistItems.toArray(),
    db.checklistOccurrences.where("date").between(startDate, endDate, true, true).toArray(),
    db.portfolioSnapshots.where("snapshotDate").between(startDate, endDate, true, true).toArray()
  ]);
  const entriesByDate: Record<ISODate, DayEntry> = {};
  const todosByDate: Record<ISODate, TodoItem[]> = {};
  const portfolioSnapshotsByDate: Record<ISODate, PortfolioSnapshot[]> = {};

  for (const entry of entries) entriesByDate[entry.date] = normalizeDayEntry(entry);
  for (const todo of [...todos, ...expandChecklistSchedules(items, occurrences, startDate, endDate)]) (todosByDate[todo.date] ??= []).push(todo);
  for (const plans of Object.values(todosByDate)) sortPlans(plans);
  for (const snapshot of snapshots.sort((a, b) => a.snapshotTime.localeCompare(b.snapshotTime) || a.createdAt.localeCompare(b.createdAt))) (portfolioSnapshotsByDate[snapshot.snapshotDate] ??= []).push(snapshot);

  return { entries: entriesByDate, todos: todosByDate, portfolioSnapshots: portfolioSnapshotsByDate };
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
  const occurrence = parseOccurrenceId(id);
  if (occurrence) {
    await db.transaction("rw", db.checklistItems, db.checklistOccurrences, async () => {
      const item = await db.checklistItems.get(occurrence.itemId);
      if (!item?.schedule || !occursOn(item.schedule, occurrence.date)) throw new Error("该安排已变更，请刷新日历");
      if (item.schedule.repeat === "none") {
        await db.checklistItems.update(item.id, { completed, updatedAt: now() });
      } else {
        await db.checklistOccurrences.put({ ...occurrence, completed, updatedAt: now() });
      }
    });
    return;
  }
  await db.todos.update(id, { completed, updatedAt: now() });
};

export const deleteTodo = async (id: string): Promise<void> => {
  await db.todos.delete(id);
};

export const listCalendarStatuses = async (startDate = format(new Date(), "yyyy-MM-01"), endDate = format(endOfMonth(parseISO(startDate)), "yyyy-MM-dd")): Promise<Record<ISODate, CalendarDayStatus>> => {
  const [entries, dailyTodos, scheduled, snapshots] = await Promise.all([
    db.dayEntries.toArray(), db.todos.toArray(),
    getCalendarMonthData(startDate, endDate),
    db.portfolioSnapshots.where("snapshotDate").between(startDate, endDate, true, true).toArray()
  ]);
  const todos = [...dailyTodos, ...Object.values(scheduled?.todos ?? {}).flat().filter(todo => todo.checklistItemId)];
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
    status.hasDiary = entry.text.trim().length > 0 || entry.tags.length > 0 || entry.weightKg !== undefined || entry.calorieDeficitKcal !== undefined;
    status.weightKg = entry.weightKg;
    status.calorieDeficitKcal = entry.calorieDeficitKcal;
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

  for (const snapshot of snapshots.sort((a, b) => a.snapshotTime.localeCompare(b.snapshotTime) || a.createdAt.localeCompare(b.createdAt))) {
    const status = ensureStatus(snapshot.snapshotDate);
    status.portfolioSnapshotId = snapshot.id;
    status.portfolioNav = snapshot.account.nav;
    status.portfolioCurrency = snapshot.currency;
  }

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
    .filter((entry) => entry.text.trim() || entry.tags.length > 0 || entry.images.length > 0 || entry.weightKg !== undefined || entry.calorieDeficitKcal !== undefined)
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
        weightKg: entry.weightKg,
        calorieDeficitKcal: entry.calorieDeficitKcal,
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
  const [calendar, reflections] = await Promise.all([
    getCalendarMonthData(start, end),
    db.monthlyReflections.where("month").between(`${year}-01`, `${year}-12`, true, true).toArray()
  ]);
  const entries = Object.values(calendar.entries);
  const todos = Object.values(calendar.todos).flat();
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
        ...monthEntries.filter((entry) => entry.text.trim() || entry.tags.length || entry.images.length || entry.weightKg !== undefined || entry.calorieDeficitKcal !== undefined).map((entry) => entry.date),
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

interface BackupDayEntry extends DayHealth {
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
  checklistGroups?: ChecklistGroup[];
  checklistItems?: ChecklistItem[];
  checklistOccurrences?: ChecklistOccurrence[];
  portfolioSnapshots?: PortfolioSnapshot[];
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
  const [profile, entries, todos, monthlyReflections, stocks, notes, revisions, images, checklistGroups, checklistItems, checklistOccurrences, portfolioSnapshots] = await db.transaction("r", db.tables, () => Promise.all([
    getProfile(), db.dayEntries.toArray(), db.todos.toArray(), db.monthlyReflections.toArray(),
    db.stocks.toArray(), db.stockNotes.toArray(), db.stockRevisions.toArray(), db.stockImages.toArray(),
    db.checklistGroups.toArray(), db.checklistItems.toArray(), db.checklistOccurrences.toArray(), db.portfolioSnapshots.toArray()
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
        ...(entry.weightKg !== undefined ? { weightKg: entry.weightKg } : {}),
        ...(entry.calorieDeficitKcal !== undefined ? { calorieDeficitKcal: entry.calorieDeficitKcal } : {}),
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
    stockMemo,
    checklistGroups,
    checklistItems,
    checklistOccurrences,
    portfolioSnapshots
  };
};

export const restoreBackupPayload = async (payload: BackupPayload): Promise<void> => {
  if (!payload || payload.app !== "riji" || payload.version !== 1) {
    throw new Error("Unsupported backup file");
  }
  const stockData = decodeStockBackup(payload.stockMemo);
  const portfolioSnapshots = payload.portfolioSnapshots === undefined ? [] : payload.portfolioSnapshots;
  if (!Array.isArray(portfolioSnapshots)) throw new Error("Invalid portfolio snapshots");
  portfolioSnapshots.forEach(validateStoredPortfolioSnapshot);
  if (new Set(portfolioSnapshots.map(snapshot => snapshot.id)).size !== portfolioSnapshots.length) throw new Error("Invalid portfolio snapshots");
  const checklistGroups = payload.checklistGroups ?? [];
  const checklistItems = payload.checklistItems ?? [];
  if (!Array.isArray(checklistGroups) || !Array.isArray(checklistItems) ||
    checklistGroups.some(group => !group || typeof group.id !== "string" || !group.id || typeof group.name !== "string" || !group.name.trim() || typeof group.createdAt !== "string" || typeof group.updatedAt !== "string") ||
    new Set(checklistGroups.map(group => group.id)).size !== checklistGroups.length ||
    checklistItems.some(item => !item || typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title.trim() || typeof item.notes !== "string" || typeof item.completed !== "boolean" || typeof item.groupId !== "string" || (item.groupId !== "" && !checklistGroups.some(group => group.id === item.groupId)) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || (item.schedule != null && !isValidSchedule(item.schedule))) ||
    new Set(checklistItems.map(item => item.id)).size !== checklistItems.length) {
    throw new Error("Invalid checklist data");
  }

  const checklistOccurrences = payload.checklistOccurrences ?? [];
  if (!Array.isArray(checklistOccurrences) || checklistOccurrences.some(state =>
    !state || typeof state.itemId !== "string" || !checklistItems.some(item => item.id === state.itemId) ||
    !isISODate(state.date) || typeof state.completed !== "boolean" || typeof state.updatedAt !== "string"
  ) || new Set(checklistOccurrences.map(state => JSON.stringify([state.itemId, state.date]))).size !== checklistOccurrences.length) {
    throw new Error("Invalid checklist occurrence data");
  }

  const monthlyReflections = payload.monthlyReflections ?? [];
  if (!Array.isArray(monthlyReflections) || monthlyReflections.some((item) =>
    !item || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) || typeof item.text !== "string" || typeof item.updatedAt !== "string"
  )) {
    throw new Error("Invalid monthly reflections");
  }

  if (!Array.isArray(payload.dayEntries) || payload.dayEntries.some(entry => !entry || (entry.weightKg !== undefined && !isValidWeight(entry.weightKg)))) {
    throw new Error("Invalid diary weight data");
  }
  if (payload.dayEntries.some(entry => entry.calorieDeficitKcal !== undefined && !isValidCalorieDeficit(entry.calorieDeficitKcal))) {
    throw new Error("Invalid diary calorie deficit data");
  }

  const dayEntries = await Promise.all(
    payload.dayEntries.map(async (entry) => ({
      date: entry.date,
      ...(entry.weightKg !== undefined ? { weightKg: entry.weightKg } : {}),
      ...(entry.calorieDeficitKcal !== undefined ? { calorieDeficitKcal: entry.calorieDeficitKcal } : {}),
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
    await db.checklistGroups.bulkPut(checklistGroups);
    await db.checklistItems.bulkPut(checklistItems);
    await db.checklistOccurrences.bulkPut(checklistOccurrences);
    await db.portfolioSnapshots.bulkPut(portfolioSnapshots);
  });
};
