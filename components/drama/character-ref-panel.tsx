"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Check, User, Camera, SkipForward } from "lucide-react";
import { toast } from "sonner";
import type { Character } from "@/types/drama";

interface CharacterRefPanelProps {
  dramaId: string;
  characters: Character[];
  onCharactersUpdate: (characters: Character[]) => void;
}

export function CharacterRefPanel({
  dramaId,
  characters: initialCharacters,
  onCharactersUpdate,
}: CharacterRefPanelProps) {
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [generating, setGenerating] = useState<string | "all" | null>(null);
  const [skipped, setSkipped] = useState(false);

  const toPublicUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.includes(".cos.") && url.startsWith("http")) {
      try {
        const u = new URL(url);
        return `/api/uploads/cos/${encodeURIComponent(u.pathname.slice(1))}`;
      } catch {
        return url;
      }
    }
    if (url.startsWith("http")) return url;
    return `/api/uploads/${url.replace(/^\.?\/?uploads\/?/, "")}`;
  };

  const hasAllRefs = characters.every((c) => c.referenceImageUrl);
  const missingCount = characters.filter((c) => !c.referenceImageUrl).length;

  // 生成单个角色参考图
  const handleGenerateOne = useCallback(
    async (charName: string) => {
      if (!dramaId) return;
      setGenerating(charName);

      try {
        const res = await fetch("/api/generate/character-reference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dramaId, characterName: charName }),
        });
        const data = await res.json();

        if (!res.ok) {
          toast.error(data.error || `生成 ${charName} 参考图失败`);
          return;
        }

        // 更新本地角色数据
        const updated = characters.map((c) =>
          c.name === charName
            ? { ...c, referenceImageUrl: data.referenceImageUrl }
            : c
        );
        setCharacters(updated);
        onCharactersUpdate(updated);
        toast.success(`${charName} 参考图已生成`);
      } catch {
        toast.error("生成失败，请重试");
      } finally {
        setGenerating(null);
      }
    },
    [dramaId, characters, onCharactersUpdate]
  );

  // 批量生成所有缺少参考图的角色
  const handleGenerateAll = useCallback(async () => {
    if (!dramaId) return;
    setGenerating("all");

    try {
      const res = await fetch("/api/generate/character-references-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "批量生成失败");
        setGenerating(null);
        return;
      }

      if (data.taskId) {
        // 异步任务，轮询状态
        let attempts = 0;
        const maxAttempts = 120; // 6 分钟超时
        const poll = setInterval(async () => {
          attempts++;
          try {
            const taskRes = await fetch(`/api/tasks/${data.taskId}`);
            const taskData = await taskRes.json();

            if (
              taskData.status === "completed" ||
              taskData.status === "completed"
            ) {
              clearInterval(poll);
              setGenerating(null);
              // 重新获取 drama 数据以拿到更新后的 characters
              const dramaRes = await fetch(`/api/dramas/${dramaId}`);
              if (dramaRes.ok) {
                const dramaData = await dramaRes.json();
                const chars: Character[] = Array.isArray(dramaData.characters)
                  ? dramaData.characters
                  : [];
                setCharacters(chars);
                onCharactersUpdate(chars);
              }
              toast.success("所有角色参考图生成完成");
            } else if (taskData.status === "failed") {
              clearInterval(poll);
              setGenerating(null);
              toast.error(taskData.errorMessage || "角色参考图生成失败");
            }
          } catch {
            if (attempts >= maxAttempts) {
              clearInterval(poll);
              setGenerating(null);
              toast.error("轮询超时，请刷新页面查看");
            }
          }
          if (attempts >= maxAttempts) {
            clearInterval(poll);
            setGenerating(null);
            toast.error("生成超时，请刷新页面查看");
          }
        }, 3000);
      } else if (data.characters) {
        setCharacters(data.characters);
        onCharactersUpdate(data.characters);
        toast.success(data.message || "参考图已生成");
        setGenerating(null);
      } else {
        setGenerating(null);
      }
    } catch {
      toast.error("批量生成失败");
      setGenerating(null);
    }
  }, [dramaId, onCharactersUpdate]);

  const handleSkip = () => {
    setSkipped(true);
    toast.info("已跳过，AI 将使用提示词进行角色一致性");
  };

  // 跳过后不显示
  if (skipped) return null;

  return (
    <div className="mb-8 border border-emerald-500/30 rounded-xl bg-emerald-500/5 p-4 sm:p-6">
      {/* 标题 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-emerald-400" />
            角色外貌确认
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            为每个角色生成标准参考照，后续所有镜头将基于此保持一致性
            {!hasAllRefs && `（还剩 ${missingCount} 个角色未生成）`}
          </p>
        </div>
        {hasAllRefs && (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
            <Check className="h-3 w-3" /> 全部就绪
          </span>
        )}
      </div>

      {/* 角色卡片列表 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-5">
        {characters.map((char) => {
          const refUrl = toPublicUrl(char.referenceImageUrl);
          const isGeneratingThis =
            generating === char.name || generating === "all";

          return (
            <div
              key={char.name}
              className="border border-border/50 rounded-lg overflow-hidden bg-card/50"
            >
              {/* 参考图 */}
              <div className="aspect-square bg-muted/50 relative">
                {refUrl ? (
                  <>
                    <img
                      src={refUrl}
                      alt={char.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2 bg-emerald-500/90 text-white text-[10px] px-1.5 py-0.5 rounded">
                      参考图
                    </div>
                  </>
                ) : isGeneratingThis ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                    <span className="text-xs text-muted-foreground">
                      生成中...
                    </span>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/50">
                    <User className="h-10 w-10" />
                    <span className="text-xs">暂无参考图</span>
                  </div>
                )}
              </div>

              {/* 角色信息 */}
              <div className="p-3">
                <h4 className="font-medium text-sm">{char.name}</h4>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {char.appearance || char.description || "暂无描述"}
                </p>

                {/* 操作按钮 */}
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateOne(char.name)}
                    disabled={!!generating}
                    className="w-full h-8 text-xs"
                  >
                    {isGeneratingThis ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : refUrl ? (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    ) : (
                      <Camera className="h-3 w-3 mr-1" />
                    )}
                    {refUrl ? "重新生成" : "生成参考图"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部操作 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        {!hasAllRefs && (
          <Button
            onClick={handleGenerateAll}
            disabled={!!generating}
            className="bg-emerald-600 hover:bg-emerald-500 h-10"
          >
            {generating === "all" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                批量生成中...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                一键生成全部（{missingCount} 个角色，{missingCount} 积分）
              </>
            )}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleSkip}
          disabled={!!generating}
          className="h-10"
        >
          <SkipForward className="h-4 w-4 mr-2" />
          跳过（使用提示词一致性）
        </Button>
      </div>
    </div>
  );
}
