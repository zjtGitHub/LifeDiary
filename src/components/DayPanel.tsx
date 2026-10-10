import { ImagePlus, Plus, Tag, Trash2, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { DayEntry, DiaryImage } from "../types";
import { displayDate } from "../lib/date";
import { TodoList } from "./TodoList";
import type { TodoItem } from "../types";

interface DayPanelProps {
  date: string;
  entry: DayEntry;
  text: string;
  todos: TodoItem[];
  saveStatus: string;
  onTextChange: (value: string) => void;
  onTagsChange: (tags: string[]) => Promise<void>;
  onAddImages: (files: File[]) => Promise<void>;
  onDeleteImage: (imageId: string) => Promise<void>;
  onAddTodo: (title: string) => Promise<void>;
  onToggleTodo: (id: string, completed: boolean) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
}

function ImagePreview({ image, onDelete }: { image: DiaryImage; onDelete: (id: string) => Promise<void> }) {
  const url = useMemo(() => URL.createObjectURL(image.blob), [image.blob]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <figure className="image-tile">
      <img src={url} alt={image.name || "日记图片"} />
      <figcaption>
        <span>{image.name || "图片"}</span>
        <button
          className="icon-button image-delete"
          type="button"
          onClick={() => onDelete(image.id)}
          aria-label={`删除图片：${image.name || "图片"}`}
          title="删除图片"
        >
          <Trash2 size={16} />
        </button>
      </figcaption>
    </figure>
  );
}

export function DayPanel({
  date,
  entry,
  text,
  todos,
  saveStatus,
  onTextChange,
  onTagsChange,
  onAddImages,
  onDeleteImage,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo
}: DayPanelProps) {
  const [tagDraft, setTagDraft] = useState("");
  const tags = entry.tags ?? [];

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      await onAddImages(files);
      event.target.value = "";
    }
  };

  const handleAddTag = async (event: FormEvent) => {
    event.preventDefault();
    const tag = tagDraft.trim().replace(/^#/, "");
    if (!tag) {
      return;
    }
    await onTagsChange([...tags, tag]);
    setTagDraft("");
  };

  const handleRemoveTag = async (tag: string) => {
    await onTagsChange(tags.filter((item) => item !== tag));
  };

  return (
    <div className="day-layout">
      <section className="panel diary-panel" aria-label="当天日记">
        <div className="section-heading">
          <div>
            <p className="eyebrow">选中的一天</p>
            <h1>{displayDate(date)}</h1>
          </div>
          <span className="save-status">{saveStatus}</span>
        </div>

        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="写下今天发生了什么、想到了什么。"
          aria-label="日记正文"
        />

        <div className="tag-section">
          <form className="tag-form" onSubmit={handleAddTag}>
            <label>
              <Tag size={16} />
              <input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                placeholder="添加标签"
                aria-label="添加标签"
              />
            </label>
            <button className="secondary icon-button" type="submit" aria-label="保存标签" title="保存标签">
              <Plus size={17} />
            </button>
          </form>
          {tags.length > 0 ? (
            <div className="tag-list" aria-label="当前标签">
              {tags.map((tag) => (
                <span key={tag}>
                  #{tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`删除标签：${tag}`} title="删除标签">
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="image-section">
          <div className="section-heading compact">
            <div>
              <h2>图片</h2>
              <p>{entry.images.length === 0 ? "还没有图片" : `${entry.images.length} 张图片`}</p>
            </div>
            <label className="secondary icon-text-button upload-button">
              <ImagePlus size={17} />
              添加图片
              <input type="file" accept="image/*" multiple onChange={handleImageChange} />
            </label>
          </div>

          {entry.images.length === 0 ? (
            <div className="diary-image-empty"><ImagePlus size={22} strokeWidth={1.4} aria-hidden="true" /><p>可以把这一天的照片放在这里。</p></div>
          ) : (
            <div className="image-grid">
              {entry.images.map((image) => (
                <ImagePreview image={image} key={image.id} onDelete={onDeleteImage} />
              ))}
            </div>
          )}
        </div>
      </section>

      <TodoList todos={todos} onAdd={onAddTodo} onToggle={onToggleTodo} onDelete={onDeleteTodo} />
    </div>
  );
}
