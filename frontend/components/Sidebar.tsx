"use client";

import { Hash, AlignLeft, Calendar, Tag } from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  numeric: <Hash size={14} />,
  numeric_category: <Hash size={14} />,
  text: <AlignLeft size={14} />,
  datetime: <Calendar size={14} />,
  boolean: <Tag size={14} />,
  categorical: <Tag size={14} />,
  identifier: <Hash size={14} />,
};

export default function Sidebar({
  columns,
  types,
  selected,
  onSelect,
}: {
  columns: string[];
  types: Record<string, string>;
  selected: string | null;
  onSelect: (col: string) => void;
}) {
  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Columns ({columns.length})
        </span>
      </div>
      <ul>
        {columns.map((col) => (
          <li key={col}>
            <button
              onClick={() => onSelect(col)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors
                ${selected === col
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-600 hover:bg-slate-50"}`}
            >
              <span className="text-slate-400 shrink-0">
                {TYPE_ICONS[types[col]] ?? <Tag size={14} />}
              </span>
              <span className="truncate">{col}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
