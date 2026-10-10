import { ArrowLeftRight, CalendarDays, ClipboardCheck, Lightbulb } from "lucide-react";
import type { StockNoteType } from "../../types";

const appearance = {
  想法: { className: "thought", Icon: Lightbulb },
  事件: { className: "event", Icon: CalendarDays },
  操作: { className: "action", Icon: ArrowLeftRight },
  复盘: { className: "review", Icon: ClipboardCheck }
} as const;

export function StockNoteTypeBadge({ type }: { type: StockNoteType }) {
  const { className, Icon } = appearance[type];
  return <span className={`stock-type-badge stock-type-${className}`}><Icon size={14} aria-hidden="true" />{type}</span>;
}
