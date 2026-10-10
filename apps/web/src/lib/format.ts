const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday" … in the given language; anything under a minute is "now". */
export function formatRelativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/**
 * Local clock time of a message in the language's short style: "14:05" or "09:05" in German,
 * "2:05 PM" in English.
 */
export function formatClockTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
}

/** Whether two points in time fall on the same calendar day in the browser's time zone. */
export function isSameLocalDay(a: string | number | Date, b: string | number | Date): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/**
 * A point in time something is free again, e.g. a limit (spec 31a), as short as it can be said:
 * the time today ("14:05"), the day with the time if it is within a day and a half ("11. Oktober
 * um 02:00"), and the day alone after that ("1. November").
 */
export function formatUntil(iso: string, locale: string, now = Date.now()): string {
  if (isSameLocalDay(iso, now)) return formatClockTime(iso, locale);
  const soon = Date.parse(iso) - now < 36 * 60 * 60_000;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(soon ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}

/** Local date for day dividers: "28. September 2026" or "September 28, 2026". */
export function formatLongDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
}

/**
 * An amount in US dollars as the language writes it: "6,17 $" or "$6.17". An amount that is there
 * but rounds to nothing says so ("< 0,01 $") instead of looking like none.
 */
export function formatUsd(amount: number, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  return amount > 0 && amount < 0.005 ? `< ${format.format(0.01)}` : format.format(amount);
}

/**
 * A share of something as a percentage: "6,2 %" under a tenth, "42 %" above. A share that is
 * there but rounds to nothing says so ("< 0,1 %").
 */
export function formatShare(ratio: number, locale: string): string {
  const format = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: ratio < 0.1 ? 1 : 0,
  });
  return ratio > 0 && ratio < 0.0005 ? `< ${format.format(0.001)}` : format.format(ratio);
}

/** A large count as short as it reads well: "85.300" stays, "1,2 Mio." from a million on. */
export function formatCount(count: number, locale: string): string {
  return new Intl.NumberFormat(
    locale,
    count >= 1_000_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {},
  ).format(count);
}

/** A calendar month of UTC like "2026-10" as its name: "Oktober 2026". */
export function formatMonth(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** A day of UTC like "2026-10-07" as its date without the year: "7. Oktober". */
export function formatDayOfMonth(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** Up to two initials from a display name, e.g. "Olga Owner" → "OO". */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.join('') || '?';
}
