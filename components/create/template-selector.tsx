"use client";

import { useState, useEffect } from "react";
import { Loader2, ChevronDown, ChevronUp, Sparkles } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  tags: string[];
  theme: string;
  genre: string;
  style: string;
  episodeCount: number;
}

interface TemplateSelectorProps {
  onSelect: (template: { theme: string; genre: string; style: string; episodeCount: number }) => void;
  selectedTheme: string;
}

/** 热门标签 */
const HOT_TAGS = ["全部", "热门", "霸总", "逆袭", "穿越", "甜宠", "悬疑", "古风", "科幻", "职场", "搞笑"];

export function TemplateSelector({ onSelect, selectedTheme }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTag, setActiveTag] = useState("全部");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    activeTag === "全部" ? templates : templates.filter((t) => t.tags.includes(activeTag));

  // 标记已选中的模板（theme 匹配）
  const selectedId = templates.find((t) => t.theme === selectedTheme)?.id;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载模板...
      </div>
    );
  }

  if (templates.length === 0) return null;

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-card/30">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between p-3 sm:p-4 cursor-pointer hover:bg-card/50 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium">{filtered.length} 个模板</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {expanded && (
        <>
          {/* 标签筛选 */}
          <div className="px-3 sm:px-4 pb-3 border-b border-border/30">
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
              {HOT_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTag === tag
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-muted/30 text-muted-foreground border border-transparent hover:border-border"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* 模板网格 */}
          <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5 max-h-[400px] overflow-y-auto">
            {filtered.map((t) => {
              const isSelected = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => onSelect({ theme: t.theme, genre: t.genre, style: t.style, episodeCount: t.episodeCount })}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-border/30 bg-card/20 hover:border-emerald-500/30 hover:bg-emerald-500/5"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xl shrink-0">{t.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium truncate">{t.name}</h4>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{t.description}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{t.episodeCount}集</span>
                        {t.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-[10px] text-muted-foreground">{tag}</span>
                        ))}
                        {isSelected && (
                          <span className="text-[10px] text-emerald-400 ml-auto">✓ 已选</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
