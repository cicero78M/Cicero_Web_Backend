export function isValidDateString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === trimmed
  );
}

export function isValidYearMonthString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    return false;
  }

  const [year, month] = trimmed.split('-').map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
}

export function validateDateRange(startDate, endDate) {
  if (startDate && !isValidDateString(startDate)) {
    return { error: 'Parameter start_date harus berformat YYYY-MM-DD' };
  }

  if (endDate && !isValidDateString(endDate)) {
    return { error: 'Parameter end_date harus berformat YYYY-MM-DD' };
  }

  if (startDate && endDate && startDate > endDate) {
    return {
      error:
        'Parameter tanggal tidak valid: start_date harus lebih kecil atau sama dengan end_date',
    };
  }

  return { startDate, endDate };
}

export function validateTanggalFilter(tanggal, periode = 'harian') {
  if (!tanggal) {
    return { tanggal };
  }

  if (periode === 'bulanan') {
    if (!isValidDateString(tanggal) && !isValidYearMonthString(tanggal)) {
      return { error: 'Parameter tanggal harus berformat YYYY-MM-DD atau YYYY-MM' };
    }
    return { tanggal };
  }

  if (!isValidDateString(tanggal)) {
    return { error: 'Parameter tanggal harus berformat YYYY-MM-DD' };
  }

  return { tanggal };
}
