"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import StoryboardPageContent from "./storyboard-content";

function StoryboardSkeleton() {
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

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {/* Drama title */}
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-6" />

        {/* Episode tabs */}
        <div className="flex gap-2 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 rounded-lg" />
          ))}
        </div>

        {/* Shot grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-lg" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
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

export default function StoryboardPage() {
  return (
    <Suspense fallback={<StoryboardSkeleton />}>
      <StoryboardPageContent />
    </Suspense>
  );
}
