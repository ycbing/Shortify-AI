"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { Toaster, toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSent(true);
      } else {
        toast.error(data.error || "发送失败");
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

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

        <h1 className="text-xl font-bold mb-1">忘记密码</h1>
        <p className="text-sm text-muted-foreground mb-6">
          输入注册邮箱，我们将发送重置链接
        </p>

        {sent ? (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
            <p className="font-semibold mb-1">邮件已发送</p>
            <p className="text-sm text-muted-foreground">
              如果该邮箱已注册，你将收到重置密码的邮件
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
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
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />发送中...</>
              ) : (
                "发送重置链接"
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
