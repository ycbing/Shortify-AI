"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ScriptPageContent from "./script-content";

function ScriptSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header skeleton */}
      <div className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center px-4 h-14 sm:h-16">
          <Skeleton className="h-6 w-48" />
          <div className="ml-auto">
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
        {/* Drama title */}
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-6" />

        {/* Episode tabs */}
        <div className="flex gap-2 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 rounded-lg" />
          ))}
        </div>

        {/* Script content skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-8">
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-36" />
        </div>
      </main>
    </div>
  );
}

export default function ScriptPage() {
  return (
    <Suspense fallback={<ScriptSkeleton />}>
      <ScriptPageContent />
    </Suspense>
  );
}
