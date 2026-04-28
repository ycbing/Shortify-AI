"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold">出了点问题</h2>
            <p className="text-sm text-muted-foreground">
              应用程序发生了意外错误，请尝试重新加载页面。
            </p>
            <Button onClick={reset} className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
              <RotateCw className="h-4 w-4 mr-2" />
              重新加载
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
