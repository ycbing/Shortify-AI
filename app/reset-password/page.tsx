"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Lock, CheckCircle, AlertCircle } from "lucide-react";
import { Toaster, toast } from "sonner";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) setInvalid(true);
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("两次密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
      } else {
        toast.error(data.error || "重置失败");
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  if (invalid) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">无效的链接</h1>
          <p className="text-sm text-muted-foreground mb-6">重置链接缺失或已失效</p>
          <Link href="/forgot-password">
            <Button variant="outline" className="min-h-[44px]">重新发送</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">密码已重置</h1>
          <p className="text-sm text-muted-foreground mb-6">请使用新密码登录</p>
          <Link href="/sign-in">
            <Button className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">前往登录</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Toaster position="top-center" />
      <div className="w-full max-w-sm">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          返回登录
        </Link>

        <h1 className="text-xl font-bold mb-1">设置新密码</h1>
        <p className="text-sm text-muted-foreground mb-6">请输入新密码（至少 6 位）</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">新密码</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="至少6位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="pl-9 min-h-[44px]"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">确认新密码</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirm"
                type="password"
                placeholder="再次输入"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="pl-9 min-h-[44px]"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 min-h-[44px]"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />重置中...</>
            ) : (
              "重置密码"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
