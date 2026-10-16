import { CalendarDays, BookOpen, ChartNoAxesCombined, HardDrive, ListChecks, NotebookPen, Sprout, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { BackupMenu } from "./components/BackupMenu";
import { StockWorkspace } from "./components/stocks/StockWorkspace";
import { AppLink, navigate, usePathname } from "./lib/router";
import { Calendar } from "./components/Calendar";
import { MonthCalendar } from "./components/MonthCalendar";
import { TaskList } from "./components/TaskList";
import { DayPanel } from "./components/DayPanel";
import { LifePage } from "./components/life/LifePage";
import { MonthTimeline } from "./components/MonthTimeline";
import { SearchPanel } from "./components/SearchPanel";
import {
  addImagesToDay,
  addTodo,
  deleteImageFromDay,
  deleteTodo,
  emptyDayEntry,
  getDayEntry,
  listAllTags,
  listCalendarStatuses,
  listTodosByDate,
  saveDayTags,
  saveDayText,
  saveDayHealth,
  searchEntries,
  setTodoCompleted
} from "./lib/db";
import { buildMonthGrid, isoDate, parseISODate } from "./lib/date";
import type { CalendarDayStatus, DayEntry, DayHealth, ISODate, SearchResult, TodoItem } from "./types";

interface DiaryPageProps {
  active: boolean;
  selectedDate: ISODate;
  setSelectedDate: (date: ISODate) => void;
  month: Date;
  setMonth: (month: Date) => void;
}

function DiaryPage({ active, selectedDate, setSelectedDate, month, setMonth }: DiaryPageProps) {
  const [entry, setEntry] = useState<DayEntry>(() => emptyDayEntry(selectedDate));
  const [text, setText] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [saveStatus, setSaveStatus] = useState("已加载");
  const [isLoadingDay, setIsLoadingDay] = useState(true);
  const [calendarStatuses, setCalendarStatuses] = useState<Record<ISODate, CalendarDayStatus>>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [overviewVersion, setOverviewVersion] = useState(0);
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
    const days = buildMonthGrid(month);
    const [nextStatuses, nextTags] = await Promise.all([listCalendarStatuses(days[0].iso, days[days.length - 1].iso), listAllTags()]);
    setCalendarStatuses(nextStatuses);
    setAllTags(nextTags);
    setOverviewVersion((version) => version + 1);
  };

  useEffect(() => {
    const handleCalendarDataChange = () => {
      void refreshTodos();
      void refreshOverview();
    };
    window.addEventListener("diary-data-changed", handleCalendarDataChange);
    return () => window.removeEventListener("diary-data-changed", handleCalendarDataChange);
  }, [selectedDate, month]);

  useEffect(() => { void refreshOverview(); }, [month]);

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

  const handleSelectDate = (date: ISODate) => {
    setSelectedDate(date);
    setMonth(parseISODate(date));
  };

  const handleTagsChange = async (tags: string[]) => {
    const nextEntry = await saveDayTags(selectedDate, tags);
    setEntry(nextEntry);
    setSaveStatus("已保存标签");
    await refreshOverview();
  };

  const handleHealthChange = async (health: DayHealth) => {
    const saved = await saveDayHealth(selectedDate, health);
    setEntry(current => current.date === saved.date ? saved : current);
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
          loading={isLoadingDay}
          onHealthChange={handleHealthChange}
          onTextChange={setText}
          onTagsChange={handleTagsChange}
          onAddImages={handleAddImages}
          onDeleteImage={handleDeleteImage}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onDeleteTodo={handleDeleteTodo}
        />

        <aside className="diary-tools" aria-label="查找日记">
          <SearchPanel
            query={searchQuery}
            results={searchResults}
            tags={allTags}
            onQueryChange={setSearchQuery}
            onSelectDate={handleSelectDate}
          />
        </aside>
      </div>
      {isMonthTimelineOpen && active ? <MonthTimeline initialYear={Number(selectedDate.slice(0, 4))}
        overviewVersion={overviewVersion} onClose={() => setIsMonthTimelineOpen(false)} onSelectDate={handleSelectDate} /> : null}
    </main>
  );
}

function App() {
  const path = usePathname();
  const [month, setMonth] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<ISODate>(() => isoDate(new Date()));
  const [dataVersion, setDataVersion] = useState(0);
  const [restoreNotice, setRestoreNotice] = useState(false);
  useEffect(() => {
    const refresh = () => { setDataVersion(version => version + 1); setRestoreNotice(true); };
    window.addEventListener("diary-data-restored", refresh);
    return () => window.removeEventListener("diary-data-restored", refresh);
  }, []);
  const stockRoute = /^\/stocks(?:\/([^/]+))?(?:\/snapshots\/([^/]+))?\/?$/.exec(path);
  const isCalendarRoute = path === "/calendar";
  const isTaskListRoute = path === "/list";
  const isLifeRoute = path === "/life";
  useEffect(() => { document.title = isLifeRoute ? "人生 · 时光日记" : isCalendarRoute ? "日历 · 时光日记" : isTaskListRoute ? "清单 · 时光日记" : stockRoute ? "股票备忘录 · 时光日记" : "日记 · 时光日记"; }, [path]);
  const handleCalendarDateSelect = (date: ISODate) => {
    setSelectedDate(date);
    setMonth(parseISODate(date));
  };
  return <>
    <header className="app-navigation-shell"><nav className="app-navigation" aria-label="主导航">
      <AppLink href="/" className="app-brand" aria-label="时光日记首页"><span className="app-brand-mark"><BookOpen size={21} aria-hidden="true" /></span><span className="app-brand-name">时光日记<small>留住每一次成长</small></span></AppLink>
      <div className="app-nav-links">
        <AppLink href="/" aria-current={path === "/" ? "page" : undefined}><NotebookPen size={16} aria-hidden="true" />日记</AppLink>
        <AppLink href="/calendar" aria-current={isCalendarRoute ? "page" : undefined}><CalendarDays size={16} aria-hidden="true" />日历</AppLink>
        <AppLink href="/list" aria-current={isTaskListRoute ? "page" : undefined}><ListChecks size={16} aria-hidden="true" />清单</AppLink>
        <AppLink href="/life" aria-current={isLifeRoute ? "page" : undefined}><Sprout size={16} aria-hidden="true" />人生</AppLink>
        <AppLink href="/stocks" aria-current={stockRoute ? "page" : undefined}><ChartNoAxesCombined size={16} aria-hidden="true" />股票备忘录</AppLink>
      </div>
      <div className="app-nav-tools"><span className="app-storage-note"><HardDrive size={14} aria-hidden="true" />本地保存<span className="storage-status-dot" aria-hidden="true" /></span><BackupMenu /></div>
    </nav></header>
    {restoreNotice ? <p className="app-restore-notice" role="status">全部数据已恢复。<button type="button" className="stock-text-button" onClick={() => setRestoreNotice(false)}>关闭提示</button></p> : null}
    <div hidden={path !== "/"}><DiaryPage key={dataVersion} active={path === "/"} selectedDate={selectedDate} setSelectedDate={setSelectedDate} month={month} setMonth={setMonth} /></div>
    {isTaskListRoute ? <TaskList key={dataVersion} /> : null}
    {isCalendarRoute ? <MonthCalendar month={month} selectedDate={selectedDate} onMonthChange={setMonth} onSelectDate={handleCalendarDateSelect} /> : null}
    {isLifeRoute ? <LifePage key={dataVersion} selectedDate={selectedDate} onSelectDiaryDate={date => {
      handleCalendarDateSelect(date);
      navigate("/");
    }} /> : null}
    {stockRoute ? <StockWorkspace key={dataVersion} stockId={stockRoute[1]} snapshotId={stockRoute[2]} /> : null}
    {!stockRoute && path !== "/" && !isCalendarRoute && !isTaskListRoute && !isLifeRoute ? <main className="app-shell"><h1>页面不存在</h1><AppLink href="/">返回日记</AppLink></main> : null}
  </>;
}

export default App;
