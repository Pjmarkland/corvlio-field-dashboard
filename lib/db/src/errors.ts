type ErrorRecord = Record<string, unknown>;

function record(value: unknown): ErrorRecord | undefined {
  return value !== null && typeof value === "object" ? value as ErrorRecord : undefined;
}

/** Inspect driver causes, not Drizzle's outer SQL/parameter-bearing message. */
export function databaseErrorCause(error: unknown): ErrorRecord {
  let current = record(error) ?? { message: typeof error === "string" ? error : "Unknown database error" };
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const cause = record(current.cause);
    if (!cause) break;
    current = cause;
  }
  return current;
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^Failed query:/i.test(value)) return "Database query failed (driver cause unavailable)";
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 600);
}

/** Only allowlisted diagnostics; never SQL, parameters, detail, credentials or stacks. */
export function databaseErrorFields(error: unknown) {
  const cause = databaseErrorCause(error);
  const describe = (item: ErrorRecord) => ({
    code: safeText(item.code),
    message: safeText(item.message) ?? "Unknown database error",
    table: safeText(item.table),
    column: safeText(item.column),
  });
  return {
    databaseError: {
      ...describe(cause),
      ...(Array.isArray(cause.errors) ? {
        errors: cause.errors.slice(0, 5).map(item => describe(databaseErrorCause(item))),
      } : {}),
    },
  };
}

export function isMissingAccountDeletionTable(error: unknown): boolean {
  const cause = databaseErrorCause(error);
  return cause.code === "42P01" && (
    cause.table === "account_deletions" ||
    (typeof cause.message === "string" &&
      /\brelation "(?:public\.)?account_deletions" does not exist\b/i.test(cause.message))
  );
}
