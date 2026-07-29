const TZ = "America/Sao_Paulo";

export type ParsedDateTime = {
  date: Date;
  raw: string;
};

export function parseDateTime(input: string, now = new Date()): ParsedDateTime | null {
  const text = input.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const relative = parseRelative(text, now);
  if (relative) {
    return relative;
  }

  const numeric = parseNumeric(text, now);
  if (numeric) {
    return numeric;
  }

  return null;
}

function parseRelative(text: string, now: Date): ParsedDateTime | null {
  const timeMatch = text.match(/(?:às\s*)?(\d{1,2})(?::(\d{2}))?(?:\s*h(?:oras)?)?/);
  if (!timeMatch) {
    return null;
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? "0");
  if (hour > 23 || minute > 59) {
    return null;
  }

  const base = partsInTimeZone(now, TZ);
  let dayOffset = 0;

  if (text.includes("hoje")) {
    dayOffset = 0;
  } else if (text.includes("amanhã") || text.includes("amanha")) {
    dayOffset = 1;
  } else if (text.includes("depois de amanhã") || text.includes("depois de amanha")) {
    dayOffset = 2;
  } else {
    return null;
  }

  const date = zonedLocalToUtc(
    {
      year: base.year,
      month: base.month,
      day: base.day + dayOffset,
      hour,
      minute,
    },
    TZ,
  );

  return { date, raw: text };
}

function parseNumeric(text: string, now: Date): ParsedDateTime | null {
  const match = text.match(
    /(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?[^\d]*(\d{1,2})(?::(\d{2}))?/,
  );
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : partsInTimeZone(now, TZ).year;
  if (year < 100) {
    year += 2000;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5] ?? "0");

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const date = zonedLocalToUtc({ year, month, day, hour, minute }, TZ);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { date, raw: text };
}

export function parseReminderMinutes(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text || text === "padrão" || text === "padrao" || text === "default" || text === "ok") {
    return 60;
  }

  const skip = new Set(["pular", "skip", "-", "nao", "não", "n"]);
  if (skip.has(text)) {
    return 60;
  }

  const match = text.match(/(\d+)\s*(minutos?|mins?|m|horas?|hrs?|h|dias?|d)\b/);
  if (!match) {
    const onlyNumber = text.match(/^(\d+)$/);
    if (onlyNumber) {
      return Number(onlyNumber[1]);
    }
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("d")) {
    return value * 24 * 60;
  }
  if (unit.startsWith("h")) {
    return value * 60;
  }
  return value;
}

function partsInTimeZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
  };
}

/** Convert a civil datetime in `timeZone` to a UTC Date. */
function zonedLocalToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const utcGuess = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute),
  );
  const asTz = partsInTimeZone(utcGuess, timeZone);
  const desiredAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  const actualAsUtc = Date.UTC(
    asTz.year,
    asTz.month - 1,
    asTz.day,
    asTz.hour,
    asTz.minute,
  );
  return new Date(utcGuess.getTime() + (desiredAsUtc - actualAsUtc));
}
