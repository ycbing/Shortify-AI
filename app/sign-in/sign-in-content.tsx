"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Film, Loader2 } from "lucide-react";

export default function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("邮箱或密码错误");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-dark">
      <Card className="w-full max-w-sm bg-card/80 backdrop-blur border-border/50">
        <CardHeader className="text-center">
          <Link href="/" className="flex items-center justify-center gap-2 mb-4">
            <Film className="h-6 w-6 text-emerald-400" />
            <span className="font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              Shortify AI
            </span>
          </Link>
          <CardTitle className="text-xl">登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 rounded p-2">{error}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="bg-muted/30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
                className="bg-muted/30"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  登录中...
                </>
              ) : (
                "登录"
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？{" "}
              <Link href="/sign-up" className="text-emerald-400 hover:underline">
                免费注册
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
