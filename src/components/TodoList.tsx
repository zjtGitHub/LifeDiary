import { CalendarDays, CircleCheck, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { AppLink } from "../lib/router";
import { scheduleTimeLabel } from "../lib/schedules";
import type { TodoItem } from "../types";

interface TodoListProps {
  todos: TodoItem[];
  onAdd: (title: string) => Promise<void>;
  onToggle: (id: string, completed: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TodoList({ todos, onAdd, onToggle, onDelete }: TodoListProps) {
  const [draft, setDraft] = useState("");

  const activeCount = todos.filter((todo) => !todo.completed).length;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) {
      return;
    }
    await onAdd(title);
    setDraft("");
  };

  return (
    <section className="panel todo-panel" aria-label="当天计划">
      <div className="section-heading">
        <div>
          <h2>当天计划</h2>
          <p>{activeCount === 0 ? "今日任务已清空" : `还有 ${activeCount} 件待完成`}</p>
        </div>
      </div>

      <form className="todo-form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="添加一个计划"
          aria-label="添加计划"
        />
        <button className="primary icon-text-button" type="submit">
          <Plus size={17} />
          添加
        </button>
      </form>

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="todo-empty"><CircleCheck size={28} strokeWidth={1.3} aria-hidden="true" /><p className="empty-copy">这一天还没有计划。</p><small>给重要的事，留一点时间。</small></div>
        ) : (
          todos.map((todo) => (
            <article className="todo-item" key={todo.id}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={(event) => onToggle(todo.id, event.target.checked)}
                />
                <span className={todo.completed ? "completed" : ""}>{todo.time ? `${scheduleTimeLabel(todo)} · ` : ""}{todo.title}</span>
              </label>
              {todo.checklistItemId ? <AppLink className="icon-button subtle" href="/list" aria-label={`编辑清单安排：${todo.title}`} title="在清单中编辑时间和重复"><CalendarDays size={17} /></AppLink> : <button
                className="icon-button subtle"
                type="button"
                onClick={() => onDelete(todo.id)}
                aria-label={`删除计划：${todo.title}`}
                title="删除"
              >
                <Trash2 size={17} />
              </button>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
