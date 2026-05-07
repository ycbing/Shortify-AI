"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import SignInContent from "./sign-in-content";

function SignInSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInSkeleton />}>
      <SignInContent />
    </Suspense>
  );
}
