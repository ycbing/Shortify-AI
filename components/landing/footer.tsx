import { Film } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Film className="h-5 w-5 text-emerald-400" />
              <span className="font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                Shortify AI
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              用 AI 创作短剧，从创意到成片只需 5 分钟。
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">功能</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>AI 智能编剧</li>
              <li>AI 分镜生成</li>
              <li>AI 智能配音</li>
              <li>一键视频合成</li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">支持</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>使用教程</li>
              <li>常见问题</li>
              <li>联系我们</li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-border/50 pt-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Shortify AI. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
