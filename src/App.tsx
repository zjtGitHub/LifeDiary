import { BookOpen, ChartNoAxesCombined, HardDrive, NotebookPen, ScrollText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataBackup } from "./components/DataBackup";
import { StockWorkspace } from "./components/stocks/StockWorkspace";
import { AppLink, usePathname } from "./lib/router";
import { Calendar } from "./components/Calendar";
import { DayPanel } from "./components/DayPanel";
import { LifeGrid } from "./components/LifeGrid";
import { MonthTimeline } from "./components/MonthTimeline";
import { SearchPanel } from "./components/SearchPanel";
import {
  addImagesToDay,
  addTodo,
  deleteImageFromDay,
  deleteTodo,
  emptyDayEntry,
  getDayEntry,
  getProfile,
  getWeekSummary,
  listAllTags,
  listCalendarStatuses,
  listTodosByDate,
  saveBirthDate,
  saveDayTags,
  saveDayText,
  searchEntries,
  setTodoCompleted
} from "./lib/db";
import { isoDate, parseISODate } from "./lib/date";
import type { CalendarDayStatus, DayEntry, ISODate, Profile, SearchResult, TodoItem, WeekSummary } from "./types";

function DiaryPage({ active }: { active: boolean }) {
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState<ISODate>(() => isoDate(today));
  const [month, setMonth] = useState<Date>(() => today);
  const [entry, setEntry] = useState<DayEntry>(() => emptyDayEntry(isoDate(today)));
  const [text, setText] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [profile, setProfile] = useState<Profile>({ id: "me" });
  const [saveStatus, setSaveStatus] = useState("已加载");
  const [isLoadingDay, setIsLoadingDay] = useState(true);
  const [calendarStatuses, setCalendarStatuses] = useState<Record<ISODate, CalendarDayStatus>>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [overviewVersion, setOverviewVersion] = useState(0);
  const [selectedWeekRange, setSelectedWeekRange] = useState<{ startDate: ISODate; endDate: ISODate } | null>(null);
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [isMonthTimelineOpen, setIsMonthTimelineOpen] = useState(false);
  useEffect(() => {
    const pause = () => setIsLoadingDay(true);
    const resume = () => setIsLoadingDay(false);
    window.addEventListener("diary-data-restoring", pause);
    window.addEventListener("diary-data-restore-failed", resume);
    return () => { window.removeEventListener("diary-data-restoring", pause); window.removeEventListener("diary-data-restore-failed", resume); };
  }, []);

  const refreshTodos = async (date = selectedDate) => {
    const nextTodos = await listTodosByDate(date);
    setTodos(nextTodos);
  };

  const refreshOverview = async () => {
    const [nextStatuses, nextTags] = await Promise.all([listCalendarStatuses(), listAllTags()]);
    setCalendarStatuses(nextStatuses);
    setAllTags(nextTags);
    setOverviewVersion((version) => version + 1);
  };

  useEffect(() => {
    let alive = true;

    const loadProfile = async () => {
      const nextProfile = await getProfile();
      if (alive) {
        setProfile(nextProfile);
      }
    };

    loadProfile();
    refreshOverview();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const loadSearchResults = async () => {
      const results = await searchEntries(searchQuery);
      if (alive) {
        setSearchResults(results);
      }
    };

    loadSearchResults();

    return () => {
      alive = false;
    };
  }, [overviewVersion, searchQuery]);

  useEffect(() => {
    let alive = true;

    const loadWeekSummary = async () => {
      if (!selectedWeekRange) {
        setWeekSummary(null);
        return;
      }

      const summary = await getWeekSummary(selectedWeekRange.startDate, selectedWeekRange.endDate);
      if (alive) {
        setWeekSummary(summary);
      }
    };

    loadWeekSummary();

    return () => {
      alive = false;
    };
  }, [overviewVersion, selectedWeekRange]);

  useEffect(() => {
    let alive = true;
    setIsLoadingDay(true);

    const loadDay = async () => {
      const [nextEntry, nextTodos] = await Promise.all([getDayEntry(selectedDate), listTodosByDate(selectedDate)]);
      if (alive) {
        setEntry(nextEntry);
        setText(nextEntry.text);
        setTodos(nextTodos);
        setSaveStatus("已加载");
        setIsLoadingDay(false);
      }
    };

    loadDay();

    return () => {
      alive = false;
    };
  }, [selectedDate]);

  useEffect(() => {
    if (isLoadingDay || text === entry.text) {
      return;
    }

    setSaveStatus("保存中...");
    const timeout = window.setTimeout(async () => {
      const saved = await saveDayText(selectedDate, text);
      setEntry(saved);
      setSaveStatus("已自动保存");
      await refreshOverview();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [entry.text, isLoadingDay, selectedDate, text]);

  const applyDateSelection = (date: ISODate) => {
    setSelectedDate(date);
    setMonth(parseISODate(date));
  };

  const handleSelectDate = (date: ISODate) => {
    setSelectedWeekRange(null);
    applyDateSelection(date);
  };

  const handleSelectSummaryDate = (date: ISODate) => {
    applyDateSelection(date);
  };

  const handleSelectLifeWeek = (startDate: ISODate, endDate: ISODate) => {
    setSelectedWeekRange({ startDate, endDate });
    applyDateSelection(startDate);
  };

  const handleTagsChange = async (tags: string[]) => {
    const nextEntry = await saveDayTags(selectedDate, tags);
    setEntry(nextEntry);
    setSaveStatus("已保存标签");
    await refreshOverview();
  };

  const handleAddImages = async (files: File[]) => {
    const nextEntry = await addImagesToDay(selectedDate, files);
    setEntry(nextEntry);
    setSaveStatus("已保存图片");
    await refreshOverview();
  };

  const handleDeleteImage = async (imageId: string) => {
    const nextEntry = await deleteImageFromDay(selectedDate, imageId);
    setEntry(nextEntry);
    setSaveStatus("已删除图片");
    await refreshOverview();
  };

  const handleAddTodo = async (title: string) => {
    await addTodo(selectedDate, title);
    await refreshTodos();
    await refreshOverview();
  };

  const handleToggleTodo = async (id: string, completed: boolean) => {
    await setTodoCompleted(id, completed);
    await refreshTodos();
    await refreshOverview();
  };

  const handleDeleteTodo = async (id: string) => {
    await deleteTodo(id);
    await refreshTodos();
    await refreshOverview();
  };

  const handleSaveBirthDate = async (birthDate: ISODate) => {
    const nextProfile = await saveBirthDate(birthDate);
    setProfile(nextProfile);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">日常 · 思考 · 记忆</p>
          <h1>日记</h1>
          <p className="page-description">把平凡的日子，写成自己的故事。</p>
        </div>
        <div className="header-pills" aria-label="功能概览">
          <button type="button" className="primary icon-text-button" onClick={() => setIsMonthTimelineOpen(true)}>
            <ScrollText size={16} />月总结
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <Calendar
            month={month}
            selectedDate={selectedDate}
            statuses={calendarStatuses}
            onMonthChange={setMonth}
            onSelectDate={handleSelectDate}
          />
        </aside>

        <DayPanel
          date={selectedDate}
          entry={entry}
          text={text}
          todos={todos}
          saveStatus={saveStatus}
          onTextChange={setText}
          onTagsChange={handleTagsChange}
          onAddImages={handleAddImages}
          onDeleteImage={handleDeleteImage}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onDeleteTodo={handleDeleteTodo}
        />

        <aside className="diary-tools" aria-label="查找与备份">
          <SearchPanel
            query={searchQuery}
            results={searchResults}
            tags={allTags}
            onQueryChange={setSearchQuery}
            onSelectDate={handleSelectDate}
          />
          <DataBackup />
        </aside>

        <LifeGrid
          birthDate={profile.birthDate}
          selectedDate={selectedDate}
          weekSummary={weekSummary}
          onSaveBirthDate={handleSaveBirthDate}
          onSelectDate={handleSelectSummaryDate}
          onSelectWeek={handleSelectLifeWeek}
        />
      </div>
      {isMonthTimelineOpen && active ? <MonthTimeline initialYear={Number(selectedDate.slice(0, 4))}
        overviewVersion={overviewVersion} onClose={() => setIsMonthTimelineOpen(false)} onSelectDate={handleSelectDate} /> : null}
    </main>
  );
}

function App() {
  const path = usePathname();
  const [dataVersion, setDataVersion] = useState(0);
  const [restoreNotice, setRestoreNotice] = useState(false);
  useEffect(() => {
    const refresh = () => { setDataVersion(version => version + 1); setRestoreNotice(true); };
    window.addEventListener("diary-data-restored", refresh);
    return () => window.removeEventListener("diary-data-restored", refresh);
  }, []);
  const stockRoute = /^\/stocks(?:\/([^/]+))?\/?$/.exec(path);
  useEffect(() => { document.title = stockRoute ? "股票备忘录 · 时光日记" : "日记 · 时光日记"; }, [path]);
  return <>
    <nav className="app-navigation" aria-label="主导航">
      <AppLink href="/" className="app-brand" aria-label="时光日记首页"><span className="app-brand-mark"><BookOpen size={21} aria-hidden="true" /></span><span className="app-brand-name">时光日记<small>留住每一次成长</small></span></AppLink>
      <div className="app-nav-links">
        <AppLink href="/" aria-current={path === "/" ? "page" : undefined}><NotebookPen size={16} aria-hidden="true" />日记</AppLink>
        <AppLink href="/stocks" aria-current={stockRoute ? "page" : undefined}><ChartNoAxesCombined size={16} aria-hidden="true" />股票备忘录</AppLink>
      </div>
      <span className="app-storage-note"><HardDrive size={14} aria-hidden="true" />本地保存<span className="storage-status-dot" aria-hidden="true" /></span>
    </nav>
    {restoreNotice ? <p className="app-restore-notice" role="status">全部数据已恢复。<button type="button" className="stock-text-button" onClick={() => setRestoreNotice(false)}>关闭提示</button></p> : null}
    <div hidden={path !== "/"}><DiaryPage key={dataVersion} active={path === "/"} /></div>
    {stockRoute ? <StockWorkspace key={dataVersion} stockId={stockRoute[1]} /> : null}
    {!stockRoute && path !== "/" ? <main className="app-shell"><h1>页面不存在</h1><AppLink href="/">返回日记</AppLink></main> : null}
  </>;
}

export default App;
