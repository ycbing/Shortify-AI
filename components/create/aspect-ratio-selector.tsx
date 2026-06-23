"use client";

import { cn } from "@/lib/utils";

interface AspectRatioSelectorProps {
  value: "landscape" | "vertical";
  onChange: (value: "landscape" | "vertical") => void;
}

const OPTIONS = [
  {
    value: "landscape" as const,
    label: "横屏 16:9",
    desc: "适合电脑/电视观看",
    icon: (
      <svg className="w-8 h-6 rounded border-2 border-current" viewBox="0 0 32 18" fill="none">
        <rect x="1" y="1" width="30" height="16" rx="2" />
      </svg>
    ),
  },
  {
    value: "vertical" as const,
    label: "竖屏 9:16",
    desc: "适合抖音/快手/短剧",
    icon: (
      <svg className="w-5 h-7 rounded border-2 border-current" viewBox="0 0 18 32" fill="none">
        <rect x="1" y="1" width="16" height="30" rx="2" />
      </svg>
    ),
  },
];

export function AspectRatioSelector({ value, onChange }: AspectRatioSelectorProps) {
  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">📐 画面比例</label>
      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
              value === opt.value
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                : "border-border/50 hover:border-emerald-500/30 hover:bg-emerald-500/5 text-muted-foreground"
            )}
          >
            {opt.icon}
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-xs opacity-70">{opt.desc}</span>
            {value === opt.value && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="2,6 5,9 10,3" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
