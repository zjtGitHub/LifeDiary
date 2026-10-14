import { CalendarDays, Repeat2, Check, ChevronDown, Inbox, ListChecks, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createChecklistGroup, createChecklistItem, deleteChecklistGroup, deleteChecklistItem, listChecklists, renameChecklistGroup, updateChecklistItem } from "../lib/checklists";
import { AppLink } from "../lib/router";
import { scheduleLabel } from "../lib/schedules";
import { SchedulePicker } from "./SchedulePicker";
import type { ChecklistGroup, ChecklistItem, ChecklistSchedule } from "../types";

export function TaskList() {
  const [groups, setGroups] = useState<ChecklistGroup[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [groupId, setGroupId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [rename, setRename] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listChecklists().then(data => { if (alive) { setGroups(data.groups); setItems(data.items); } }).catch(() => { if (alive) setError("读取清单失败，请刷新重试。"); });
    return () => { alive = false; };
  }, []);

  const run = async (action: () => Promise<void>, message = "") => {
    setError(""); setNotice(""); setBusy(true);
    try {
      await action();
      const data = await listChecklists();
      setGroups(data.groups); setItems(data.items); setNotice(message);
      window.dispatchEvent(new Event("diary-data-changed"));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
      return false;
    } finally { setBusy(false); }
  };

  const chooseGroup = (id: string) => { setGroupId(id); setSelectedId(null); setRenaming(false); setNotice(""); };
  const activeGroup = groups.find(group => group.id === groupId);
  const currentName = activeGroup?.name ?? "收集箱";
  const currentItems = items.filter(item => item.groupId === groupId);
  const openItems = currentItems.filter(item => !item.completed);
  const completedItems = currentItems.filter(item => item.completed);
  const selectedItem = items.find(item => item.id === selectedId);
  const count = (id: string) => items.filter(item => item.groupId === id && !item.completed).length;

  const addGroup = (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    void run(async () => { const group = await createChecklistGroup(groupName); chooseGroup(group.id); setGroupName(""); });
  };
  const addItem = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void run(async () => { const item = await createChecklistItem(groupId, title); setTitle(""); setSelectedId(item.id); });
  };
  const renderItem = (item: ChecklistItem) => (
    <article className={`checklist-row${item.completed ? " completed" : ""}${item.id === selectedId ? " selected" : ""}`} key={item.id}>
      {item.schedule && item.schedule.repeat !== "none" ? <AppLink href="/calendar" className="checklist-repeat-icon" aria-label={`在日历中完成：${item.title}`} title="重复任务在日历中逐次完成"><Repeat2 size={18} /></AppLink> : <label className="checklist-checkbox">
        <input type="checkbox" checked={item.completed} disabled={busy} onChange={() => void run(() => updateChecklistItem(item.id, { completed: !item.completed }))} aria-label={`${item.completed ? "标记未完成" : "完成任务"}：${item.title}`} />
        <span aria-hidden="true">{item.completed ? <Check size={13} strokeWidth={3} /> : null}</span>
      </label>}
      <button className="checklist-row-title" type="button" aria-label={`查看任务：${item.title}`} onClick={() => { setSelectedId(item.id); setNotice(""); }}><span>{item.title}{item.schedule ? <small className="checklist-schedule-label"><CalendarDays size={12} aria-hidden="true" />{scheduleLabel(item.schedule)}</small> : null}</span>{item.notes ? <small>有备注</small> : null}</button>
    </article>
  );

  return (
    <main className="app-shell checklist-page">
      <header className="app-header">
        <div><p className="eyebrow">想法 · 计划 · 行动</p><h1>清单</h1><p className="page-description">把想做的事收进清单，为重要的安排留出时间。</p></div>
        <div className="header-pills"><AppLink href="/calendar" className="secondary icon-text-button checklist-calendar-link"><CalendarDays size={16} />查看日历</AppLink><span><ListChecks size={15} aria-hidden="true" />{items.filter(item => !item.completed).length} 项待办</span></div>
      </header>
      {error ? <p className="checklist-error" role="alert">{error}</p> : null}
      {notice ? <p className="checklist-notice" role="status">{notice}</p> : null}
      <div className={`panel checklist-workspace${selectedItem ? " has-detail" : ""}`}>
        <aside className="checklist-sidebar" aria-label="清单分组">
          <button className="checklist-group-link" type="button" aria-pressed={groupId === ""} onClick={() => chooseGroup("")}><Inbox size={18} aria-hidden="true" /><span>收集箱</span><small>{count("")}</small></button>
          <div className="checklist-sidebar-heading"><h2>我的清单</h2><small>{groups.length} 个分组</small></div>
          <div className="checklist-group-links">
            {groups.map(group => <button className="checklist-group-link" key={group.id} type="button" aria-pressed={groupId === group.id} onClick={() => chooseGroup(group.id)}><ListChecks size={17} aria-hidden="true" /><span>{group.name}</span><small>{count(group.id)}</small></button>)}
          </div>
          <form className="checklist-new-group" onSubmit={addGroup}>
            <input aria-label="新分组名称" value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="新建分组" />
            <button className="icon-button" type="submit" disabled={busy || !groupName.trim()} aria-label="创建分组" title="创建分组"><Plus size={17} /></button>
          </form>
        </aside>

        <section className="checklist-content" aria-label={`${currentName}任务`}>
          <div className="checklist-content-heading"><div><h2>{currentName}</h2><p>{openItems.length} 项待办</p></div>
            {activeGroup ? <button className="secondary" type="button" onClick={() => { setRename(currentName); setRenaming(value => !value); }}>管理分组</button> : null}
          </div>
          {renaming && activeGroup ? <form className="checklist-manage-group" onSubmit={event => { event.preventDefault(); void run(async () => { await renameChecklistGroup(groupId, rename); setRenaming(false); }, "分组名称已保存"); }}>
            <input aria-label="分组名称" value={rename} onChange={event => setRename(event.target.value)} />
            <button className="secondary" type="submit" disabled={busy || !rename.trim()}>保存名称</button>
            <button className="checklist-delete-group" type="button" disabled={busy} onClick={() => void run(async () => { await deleteChecklistGroup(groupId); chooseGroup(""); }, "分组已删除，任务已移到收集箱")}>删除分组</button>
            <small>删除分组后，任务会移到收集箱。</small>
          </form> : null}
          <form className="checklist-add-task" onSubmit={addItem}><Plus size={18} aria-hidden="true" /><input aria-label="添加清单任务" placeholder={`添加任务至“${currentName}”，回车创建`} value={title} onChange={event => setTitle(event.target.value)} /><button className="primary" type="submit" disabled={busy || !title.trim()}>添加</button></form>
          <div className="checklist-rows">{openItems.map(renderItem)}</div>
          {completedItems.length > 0 ? <details className="checklist-completed" open><summary><ChevronDown size={15} aria-hidden="true" />已完成 <span>{completedItems.length}</span></summary>{completedItems.map(renderItem)}</details> : null}
          {currentItems.length === 0 ? <div className="checklist-empty"><ListChecks size={32} strokeWidth={1.3} aria-hidden="true" /><strong>这里还没有任务</strong><p>记下一个想法，或添加一件想做的事。</p></div> : null}
        </section>

        {selectedItem ? <ChecklistDetail key={selectedItem.id} item={selectedItem} groups={groups} busy={busy} onClose={() => setSelectedId(null)} onSave={(changes) => run(async () => { await updateChecklistItem(selectedItem.id, changes); setGroupId(changes.groupId); }, "任务已保存")} onScheduleSave={schedule => run(() => updateChecklistItem(selectedItem.id, { schedule, ...(schedule && schedule.repeat !== "none" ? { completed: false } : {}) }), schedule ? "时间设置已保存，已同步到日历" : "已清除时间设置")} onDelete={() => run(async () => { await deleteChecklistItem(selectedItem.id); setSelectedId(null); }, "任务已删除")} /> : <aside className="checklist-detail-empty"><ListChecks size={27} strokeWidth={1.3} aria-hidden="true" /><p>选择一项任务，查看和编辑详情</p></aside>}
      </div>
    </main>
  );
}

function ChecklistDetail({ item, groups, busy, onClose, onSave, onScheduleSave, onDelete }: {
  item: ChecklistItem; groups: ChecklistGroup[]; busy: boolean; onClose: () => void;
  onSave: (changes: Pick<ChecklistItem, "title" | "notes" | "groupId">) => Promise<boolean>;
  onScheduleSave: (schedule: ChecklistSchedule | null) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [groupId, setGroupId] = useState(item.groupId);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  return <aside className="checklist-detail" aria-label="任务详情">
    <div className="checklist-detail-heading"><h2>任务详情</h2><button className="icon-button subtle" type="button" onClick={onClose} aria-label="关闭任务详情"><X size={17} /></button></div>
    <form onSubmit={event => { event.preventDefault(); void onSave({ title, notes, groupId }); }}>
      <label>任务名称<input aria-label="任务名称" value={title} onChange={event => setTitle(event.target.value)} required /></label>
      <div className="checklist-schedule-setting"><button type="button" disabled={busy} onClick={() => setScheduleOpen(true)} aria-label="设置日期和重复" aria-haspopup="dialog"><CalendarDays size={18} /><span>{item.schedule ? scheduleLabel(item.schedule) : "设置日期和重复"}</span><ChevronDown size={15} /></button>{item.schedule ? <p>已同步到日历{item.schedule.repeat !== "none" ? "，每次安排单独完成。" : "。"}<AppLink href="/calendar">查看日历</AppLink></p> : <p>可设置每周健身安排、每月还款等计划。</p>}</div>
      <label>备注<textarea aria-label="任务备注" value={notes} onChange={event => setNotes(event.target.value)} placeholder="添加说明、想法或需要准备的内容" rows={9} /></label>
      <label>所属分组<select aria-label="所属分组" value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">收集箱</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
      <div className="checklist-detail-actions"><button className="primary" type="submit" disabled={busy || !title.trim()}>保存任务</button><button className="icon-button subtle" type="button" onClick={() => void onDelete()} disabled={busy} aria-label={`删除任务：${item.title}`} title="删除任务"><Trash2 size={17} /></button></div>
    </form>
    {scheduleOpen ? <SchedulePicker schedule={item.schedule} busy={busy} onClose={() => { if (!busy) setScheduleOpen(false); }} onSave={onScheduleSave} /> : null}
  </aside>;
}
