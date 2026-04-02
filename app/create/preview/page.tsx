"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import PreviewPageContent from "./preview-content";

export default function PreviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    }>
      <PreviewPageContent />
    </Suspense>
  );
}
