"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PenLine } from "lucide-react";

interface ThemeInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function ThemeInput({ value, onChange }: ThemeInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="theme" className="text-sm font-medium inline-flex items-center gap-1">
        <PenLine className="h-4 w-4 text-emerald-400" />
        创意主题
      </Label>
      <Textarea
        id="theme"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="描述你的短剧创意，例如：一个程序员在深夜加班时，发现公司AI系统产生了自我意识..."
        rows={4}
        className="bg-muted/30 text-sm resize-none"
        maxLength={500}
      />
      <p className="text-xs text-muted-foreground text-right">
        {value.length}/500
      </p>
    </div>
  );
}
