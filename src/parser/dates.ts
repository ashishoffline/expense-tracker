/**
 * Converts any date representation (ISO with timezone, UTC, local string, or Date object)
 * into standard Indian Standard Time (IST, UTC+05:30) format: "YYYY-MM-DD HH:MM:SS".
 */
export function toISTString(input?: string | Date | null): string {
  if (!input) {
    input = new Date();
  }

  if (typeof input === "string") {
    // If already in YYYY-MM-DD HH:MM:SS format (with space or T, and no trailing timezone), normalize to space
    const plainMatch = input.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})$/);
    if (plainMatch) {
      return `${plainMatch[1]} ${plainMatch[2]}`;
    }
  }

  const d = typeof input === "string" ? new Date(input) : input;
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(validDate);

  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

/**
 * Normalizes transaction date from raw SMS date string.
 *
 * Rules:
 * - If the SMS date includes a complete time component (HH:MM:SS), returns formatted IST "YYYY-MM-DD HH:MM:SS".
 * - If the SMS date has NO time (date-only) or is absent/unparseable, returns fallbackDate.
 */
export function parseTransactionDate(
  rawDate: string | null | undefined,
  fallbackDate: string
): string {
  if (!rawDate) return toISTString(fallbackDate);

  const trimmed = rawDate.trim();

  // 1. Format: YYYY-MM-DD:HH:MM:SS (HDFC card spend)
  const hdfcDateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}:\d{2})$/);
  if (hdfcDateTime) {
    return `${hdfcDateTime[1]} ${hdfcDateTime[2]}`;
  }

  // 2. Format: DD-MM-YY HH:MM:SS (Axis card spend)
  const axisDate = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (axisDate) {
    const [, d, m, y, hh, mm, ss] = axisDate;
    return `20${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  // 3. Format: DD-Mon-YY or DD/Mon/YYYY [at HH:MM:SS] (e.g. 04-Oct-26 or 05-OCT-26 at 14:32:05)
  const monMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const monDate = trimmed.match(
    /^(\d{2})[-/]([A-Za-z]{3})[-/](\d{2,4})(?:\s+(?:at\s+)?(\d{2}):(\d{2}):(\d{2}))?$/i
  );
  if (monDate) {
    const [, d, monStr, rawY, hh, mm, ss] = monDate;
    if (hh && mm && ss) {
      const m = monMap[monStr.toLowerCase()];
      if (m) {
        const y = rawY.length === 2 ? `20${rawY}` : rawY;
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
      }
    }
    // Date only (no time) -> discard in favor of fallbackDate
    return toISTString(fallbackDate);
  }

  // All other formats (DD-MM, DD/MM/YYYY, DD/MM/YY) are date-only (no time component).
  // Per design: if SMS has no time, use payload timestamp (fallbackDate).
  return toISTString(fallbackDate);
}
