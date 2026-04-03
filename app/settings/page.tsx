"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Coins,
  Loader2,
  Plus,
  Clock,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface UsageLog {
  id: string;
  type: string;
  creditsUsed: number;
  dramaId: string | null;
  description: string | null;
  createdAt: string;
}

interface CreditInfo {
  balance: number;
  logs: UsageLog[];
}

const TYPE_LABELS: Record<string, string> = {
  script: "📝 生成剧本",
  storyboard: "🎨 生成分镜",
  voiceover: "🎙️ 生成配音",
  compose: "🎬 合成视频",
  video: "🤖 AI 视频生成",
};

const COST_DISPLAY = [
  { type: "生成剧本", cost: 10, icon: "📝" },
  { type: "分镜图片（每集）", cost: 5, icon: "🎨" },
  { type: "配音（每集）", cost: 5, icon: "🎙️" },
  { type: "视频合成（每集）", cost: 5, icon: "🎬" },
  { type: "AI 视频生成（每镜头）", cost: 20, icon: "🤖" },
];

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/user/credits");
      if (res.ok) {
        const data = await res.json();
        setCreditInfo(data);
      }
    } catch {
      toast.error("加载积分信息失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/sign-in");
      return;
    }
    if (status === "authenticated") {
      fetchCredits();
    }
  }, [status, fetchCredits]);

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  const balance = creditInfo?.balance ?? 0;
  const logs = creditInfo?.logs ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 h-14 sm:h-16">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] px-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-base sm:text-lg font-bold">账户设置</h1>
          </div>
          {session?.user && (
            <span className="text-xs sm:text-sm text-muted-foreground hidden sm:inline">
              {session.user.email}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8 space-y-6">
        {/* Credits balance card */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-5 w-5 text-emerald-400" />
              我的积分
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-emerald-400">{balance}</p>
                <p className="text-xs text-muted-foreground mt-1">剩余积分</p>
              </div>
              <Button
                onClick={() =>
                  toast.info("充值功能即将上线，敬请期待！🎉", {
                    duration: 3000,
                  })
                }
                className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]"
              >
                <Plus className="h-4 w-4 mr-2" />
                充值积分
              </Button>
            </div>

            {balance < 20 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                ⚠️ 积分不足，建议及时充值以免影响创作
              </div>
            )}
          </CardContent>
        </Card>

        {/* Credit costs reference */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              积分消耗说明
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {COST_DISPLAY.map((item) => (
                <div
                  key={item.type}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span>{item.icon}</span>
                    <span>{item.type}</span>
                  </div>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                    {item.cost} 积分
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Usage history */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-emerald-400" />
              使用记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p>暂无使用记录</p>
                <p className="text-xs mt-1">开始创作短剧后，使用记录会显示在这里</p>
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm shrink-0">
                        {TYPE_LABELS[log.type] || log.type}
                      </span>
                      {log.description && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          {log.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm text-red-400">
                        -{log.creditsUsed}
                      </span>
                      <span className="text-xs text-muted-foreground hidden sm:inline w-28 text-right">
                        {new Date(log.createdAt).toLocaleString("zh-CN", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account info */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">账户信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">邮箱</span>
              <span>{session?.user?.email || "-"}</span>
            </div>
            <Separator className="bg-border/50" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">注册时间</span>
              <span>-</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
