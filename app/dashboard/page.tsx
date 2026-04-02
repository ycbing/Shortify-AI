"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DramaCardGrid } from "@/components/drama/drama-card-grid";
import { Plus, Loader2 } from "lucide-react";
import type { DramaWithEpisodes } from "@/types/drama";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [dramas, setDramas] = useState<DramaWithEpisodes[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/sign-in");
      return;
    }

    if (status === "authenticated") {
      fetchDramas();
    }
  }, [status, filter]);

  const fetchDramas = async () => {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/dramas${params}`);
      if (res.ok) {
        const data = await res.json();
        setDramas(data.dramas || []);
      }
    } catch (error) {
      console.error("Failed to fetch dramas:", error);
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  const filterButtons = [
    { key: "all", label: "全部" },
    { key: "draft", label: "草稿" },
    { key: "generating", label: "生成中" },
    { key: "completed", label: "已完成" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">我的短剧</h1>
            {session?.user && (
              <span className="text-sm text-muted-foreground">
                {session.user.email}
              </span>
            )}
          </div>
          <Link href="/create">
            <Button className="bg-emerald-600 hover:bg-emerald-500">
              <Plus className="h-4 w-4 mr-2" />
              创建短剧
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {filterButtons.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : ""
              }
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* Drama grid */}
        <DramaCardGrid dramas={dramas} />
      </main>
    </div>
  );
}
