"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  number: number;
  title: string;
}

interface StepIndicatorProps {
  currentStep: number;
  steps: Step[];
}

export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  const current = steps.find((s) => s.number === currentStep);

  return (
    <div className="flex items-center gap-2 w-full">
      {/* Mobile: only show current step */}
      <div className="flex sm:hidden items-center gap-2 flex-1 min-w-0">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all shrink-0",
            "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25"
          )}
        >
          <span className="text-xs">{currentStep}</span>
          <span>{current?.title}</span>
        </div>
        <span className="text-xs text-muted-foreground truncate">
          {currentStep}/{steps.length}
        </span>
      </div>

      {/* Desktop: show all steps with connectors */}
      {steps.map((step, index) => (
        <div key={step.number} className="hidden sm:flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all",
              step.number === currentStep
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25"
                : step.number < currentStep
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "bg-muted/50 text-muted-foreground border border-border/50"
            )}
          >
            {step.number < currentStep ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span className="text-xs">{step.number}</span>
            )}
            <span>{step.title}</span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cn(
                "h-px w-10 transition-colors",
                step.number < currentStep
                  ? "bg-emerald-500/50"
                  : "bg-border/50"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
