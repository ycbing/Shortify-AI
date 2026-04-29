// ============================================
// Shortify AI - Structured Logger
// ============================================

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

function formatEntry(entry: LogEntry): string {
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `[${entry.timestamp}] ${entry.level.toUpperCase()} [${entry.module}] ${entry.message}${dataStr}`;
}

export function createLogger(module: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (process.env.NODE_ENV === "development") {
        console.log(formatEntry({ timestamp: new Date().toISOString(), level: "debug", module, message, data }));
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      console.log(formatEntry({ timestamp: new Date().toISOString(), level: "info", module, message, data }));
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(formatEntry({ timestamp: new Date().toISOString(), level: "warn", module, message, data }));
    },
    error(message: string, data?: Record<string, unknown>) {
      console.error(formatEntry({ timestamp: new Date().toISOString(), level: "error", module, message, data }));
    },
  };
}
