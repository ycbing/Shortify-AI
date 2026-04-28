"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw, Home } from "lucide-react";

export default function CreateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Create page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold">创作页面出错了</h2>
        <p className="text-sm text-muted-foreground">
          抱歉，页面加载过程中发生了错误。你可以尝试重新加载或返回首页。
        </p>
        {error.message && (
          <div className="p-3 rounded-lg bg-muted text-xs text-left text-muted-foreground max-h-20 overflow-y-auto">
            <code>{error.message}</code>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button onClick={reset} variant="outline" className="min-h-[44px]">
            <RotateCw className="h-4 w-4 mr-2" />
            重新加载
          </Button>
          <Button onClick={() => (window.location.href = "/dashboard")} className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
            <Home className="h-4 w-4 mr-2" />
            返回首页
          </Button>
        </div>
      </div>
    </div>
  );
}
