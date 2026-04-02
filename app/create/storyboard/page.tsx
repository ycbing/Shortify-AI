"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import StoryboardPageContent from "./storyboard-content";

export default function StoryboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    }>
      <StoryboardPageContent />
    </Suspense>
  );
}
