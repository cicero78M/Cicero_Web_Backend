const JAKARTA_TIMEZONE = 'Asia/Jakarta';
const LOCALE_ID = 'id-ID';

function normalizeDateInput(date) {
  return date instanceof Date ? date : new Date(date);
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
