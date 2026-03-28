const JAKARTA_TIMEZONE = 'Asia/Jakarta';
const LOCALE_ID = 'id-ID';
const JAKARTA_UTC_OFFSET_HOURS = 7;

const jakartaDatePartFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: JAKARTA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function normalizeDateInput(date) {
  return date instanceof Date ? date : new Date(date);
}

function getJakartaDateParts(referenceDate) {
  const normalizedDate = normalizeDateInput(referenceDate ?? new Date());
  const parts = jakartaDatePartFormatter.formatToParts(normalizedDate);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return { year, month, day };
}

function toUtcDateFromJakarta({ year, month, day }, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - JAKARTA_UTC_OFFSET_HOURS,
      minute,
      second,
      millisecond
    )
  );
}

function shiftJakartaCalendarDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function getJakartaDayRange(referenceDate = new Date()) {
  const currentDate = getJakartaDateParts(referenceDate);
  const nextDate = shiftJakartaCalendarDays(currentDate, 1);
  return {
    start: toUtcDateFromJakarta(currentDate),
    end: toUtcDateFromJakarta(nextDate),
  };
}

export function getJakartaWeekRange(referenceDate = new Date()) {
  const currentDate = getJakartaDateParts(referenceDate);
  const currentDay = new Date(Date.UTC(currentDate.year, currentDate.month - 1, currentDate.day)).getUTCDay();
  const daysFromMonday = (currentDay + 6) % 7;
  const weekStart = shiftJakartaCalendarDays(currentDate, -daysFromMonday);
  const weekEnd = shiftJakartaCalendarDays(weekStart, 7);
  return {
    start: toUtcDateFromJakarta(weekStart),
    end: toUtcDateFromJakarta(weekEnd),
  };
}

export function getJakartaMonthRange(referenceDate = new Date()) {
  const currentDate = getJakartaDateParts(referenceDate);
  const monthStart = {
    year: currentDate.year,
    month: currentDate.month,
    day: 1,
  };
  const nextMonth = currentDate.month === 12
    ? { year: currentDate.year + 1, month: 1, day: 1 }
    : { year: currentDate.year, month: currentDate.month + 1, day: 1 };

  return {
    start: toUtcDateFromJakarta(monthStart),
    end: toUtcDateFromJakarta(nextMonth),
  };
}

export function formatDateWIB(date, options = {}) {
  const normalizedDate = normalizeDateInput(date);
  return normalizedDate.toLocaleDateString(LOCALE_ID, {
    timeZone: JAKARTA_TIMEZONE,
    ...options,
  });
}

export function formatTimeWIB(date, options = {}) {
  const normalizedDate = normalizeDateInput(date);
  return normalizedDate.toLocaleTimeString(LOCALE_ID, {
    timeZone: JAKARTA_TIMEZONE,
    hour12: false,
    ...options,
  });
}

export function formatDateTimeWIB(date, options = {}) {
  const normalizedDate = normalizeDateInput(date);
  return normalizedDate.toLocaleString(LOCALE_ID, {
    timeZone: JAKARTA_TIMEZONE,
    ...options,
  });
}

export { JAKARTA_TIMEZONE };
