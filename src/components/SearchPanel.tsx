import { Image, Search, Tag } from "lucide-react";
import type { SearchResult } from "../types";
import { healthLabels } from "../lib/health";

interface SearchPanelProps {
  query: string;
  results: SearchResult[];
  tags: string[];
  onQueryChange: (query: string) => void;
  onSelectDate: (date: string) => void;
}

const previewText = (text: string): string => {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "没有正文";
  }

  return normalized.length > 62 ? `${normalized.slice(0, 62)}...` : normalized;
};

export function SearchPanel({ query, results, tags, onQueryChange, onSelectDate }: SearchPanelProps) {
  return (
    <section className="panel search-panel" aria-label="搜索日记">
      <div className="section-heading compact">
        <div>
          <h2>搜索</h2>
          <p>正文、日期和标签</p>
        </div>
      </div>

      <label className="search-box">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索日记或 #标签"
          aria-label="搜索日记"
        />
      </label>

      {tags.length > 0 ? (
        <div className="tag-cloud" aria-label="标签列表">
          {tags.map((tag) => (
            <button key={tag} type="button" onClick={() => onQueryChange(`#${tag}`)}>
              <Tag size={13} />
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      <div className="search-results">
        {results.length === 0 ? (
          <p className="empty-copy">没有找到日记。</p>
        ) : (
          results.map((result) => (
            <button className="search-result" key={result.date} type="button" onClick={() => onSelectDate(result.date)}>
              <span className="search-date">{result.date}</span>
              <span>{result.text.trim() ? previewText(result.text) : healthLabels(result).join(" · ") || previewText(result.text)}</span>
              <small>
                {result.tags.map((tag) => `#${tag}`).join(" ")}
                {result.imageCount > 0 ? (
                  <>
                    {" "}
                    <Image size={12} />
                    {result.imageCount}
                  </>
                ) : null}
                {result.todoCount > 0 ? ` 计划 ${result.openTodoCount}/${result.todoCount}` : ""}
              </small>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
