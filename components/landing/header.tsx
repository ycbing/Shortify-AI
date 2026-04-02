"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Film, Menu, X } from "lucide-react";
import { useState } from "react";

export function Header() {
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Film className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
            Shortify AI
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/#features" className="text-sm text-muted-foreground hover:text-foreground transition">
            功能
          </Link>
          {session ? (
            <>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">我的短剧</Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                退出
              </Button>
            </>
          ) : (
            <>
              <Link href="/sign-in">
                <Button variant="outline" size="sm">登录</Button>
              </Link>
              <Link href="/sign-up">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500">
                  免费注册
                </Button>
              </Link>
            </>
          )}
        </nav>

        {/* Mobile menu button */}
        <button
          className="md:hidden text-muted-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl p-4 space-y-3">
          <Link href="/#features" className="block text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>功能</Link>
          {session ? (
            <>
              <Link href="/dashboard" className="block" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" size="sm" className="w-full">我的短剧</Button>
              </Link>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => signOut({ callbackUrl: "/" })}>退出</Button>
            </>
          ) : (
            <div className="flex gap-2">
              <Link href="/sign-in" className="flex-1" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" size="sm" className="w-full">登录</Button>
              </Link>
              <Link href="/sign-up" className="flex-1" onClick={() => setMobileOpen(false)}>
                <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-500">注册</Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
