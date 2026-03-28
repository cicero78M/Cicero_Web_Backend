import { query } from '../../../db/index.js';
import { getWebLoginCountsByActor } from '../../../model/loginLogModel.js';
import { getGreeting } from '../../../utils/utilsHelper.js';
import {
  getJakartaDayRange,
  getJakartaMonthRange,
  getJakartaWeekRange,
} from '../../../utils/dateTimeJakarta.js';

const numberFormatter = new Intl.NumberFormat('id-ID');
const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});
const monthFormatter = new Intl.DateTimeFormat('id-ID', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});
const monthYearValidationFormatter = new Intl.DateTimeFormat('id-ID', {
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

function validateDateFormatConsistency(date) {
  const formatTarget = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(formatTarget.getTime())) {
    throw new Error('Tanggal tidak valid untuk formatter Asia/Jakarta');
  }

  const dateParts = dateFormatter.formatToParts(formatTarget);
  const monthLabelParts = monthFormatter.formatToParts(formatTarget);
  const monthValidationParts = monthYearValidationFormatter.formatToParts(formatTarget);

  const dateMonth = dateParts.find((part) => part.type === 'month')?.value;
  const dateYear = dateParts.find((part) => part.type === 'year')?.value;
  const monthValidation = monthValidationParts.find((part) => part.type === 'month')?.value;
  const monthYear = monthValidationParts.find((part) => part.type === 'year')?.value;
  const monthLabel = monthLabelParts.find((part) => part.type === 'month')?.value;

  if (dateMonth !== monthValidation || dateYear !== monthYear || !monthLabel) {
    throw new Error('Formatter tanggal tidak konsisten pada timezone Asia/Jakarta');
  }
}

function startOfDay(date) {
  return getJakartaDayRange(date).start;
}

function endOfDay(date) {
  return new Date(getJakartaDayRange(date).end.getTime() - 1);
}

function startOfMonth(date) {
  return getJakartaMonthRange(date).start;
}

function endOfMonth(date) {
  return new Date(getJakartaMonthRange(date).end.getTime() - 1);
}

function resolveRange({ mode, startTime, endTime }) {
  const normalizedMode = mode === 'mingguan' ? 'mingguan' : 'harian';
  let start = startTime ? new Date(startTime) : null;
  let end = endTime ? new Date(endTime) : null;

  if (startTime && Number.isNaN(start?.getTime())) {
    throw new Error('startTime tidak valid');
  }

  if (endTime && Number.isNaN(end?.getTime())) {
    throw new Error('endTime tidak valid');
  }

  if (!start && !end) {
    if (normalizedMode === 'mingguan') {
      const weeklyRange = getJakartaWeekRange(new Date());
      start = weeklyRange.start;
      end = new Date(weeklyRange.end.getTime() - 1);
    } else {
      start = startOfDay(new Date());
      end = endOfDay(new Date());
    }
  } else {
    start = start ? startOfDay(start) : startOfDay(end);
    end = end ? endOfDay(end) : endOfDay(start);
  }

  return { start, end, mode: normalizedMode };
}

function resolveMonthlyRange({ startTime, endTime }) {
  const baseDate = startTime || endTime || new Date();
  const parsed = new Date(baseDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Tanggal periode bulanan tidak valid');
  }
  const start = startOfMonth(baseDate);
  const end = endOfMonth(baseDate);
  return { start, end };
}

function formatDate(date) {
  validateDateFormatConsistency(date);
  return dateFormatter.format(date);
}

function formatMonthYear(date) {
  validateDateFormatConsistency(date);
  return monthFormatter.format(date);
}

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

async function fetchActorDetails(actorIds = []) {
  if (!actorIds.length) {
    return new Map();
  }
  const uniqueIds = Array.from(new Set(actorIds.filter(Boolean)));

  const [dashboardRes, penmasRes] = await Promise.all([
    query(
      `SELECT du.dashboard_user_id AS actor_id, du.username, r.role_name AS role
       FROM dashboard_user du
       LEFT JOIN roles r ON du.role_id = r.role_id
       WHERE du.dashboard_user_id = ANY($1)`,
      [uniqueIds]
    ),
    query(
      'SELECT user_id AS actor_id, username, role FROM penmas_user WHERE user_id = ANY($1)',
      [uniqueIds]
    ),
  ]);

  const details = new Map();
  (dashboardRes.rows || []).forEach((row) => {
    details.set(row.actor_id, { ...row, source: 'dashboard' });
  });
  (penmasRes.rows || []).forEach((row) => {
    if (!details.has(row.actor_id)) {
      details.set(row.actor_id, { ...row, source: 'penmas' });
    }
  });
  return details;
}

async function fetchPolresLoginRecap({ startTime, endTime }) {
  const { rows } = await query(
    `SELECT UPPER(c.client_id) AS client_id,
            COALESCE(c.nama, c.client_id) AS nama,
            COUNT(DISTINCT ll.actor_id) AS operator_count,
            COUNT(ll.logged_at) AS login_count
     FROM clients c
     LEFT JOIN dashboard_user_clients duc ON duc.client_id = c.client_id
     LEFT JOIN login_log ll ON ll.actor_id = duc.dashboard_user_id::TEXT
       AND ll.login_source = 'web'
       AND ll.logged_at >= $1
       AND ll.logged_at <= $2
     WHERE LOWER(c.client_type) = 'org'
     GROUP BY c.client_id, c.nama`,
    [startTime, endTime]
  );

  return rows.map((row) => ({
    client_id: row.client_id,
    nama: row.nama,
    operator_count: Number(row.operator_count) || 0,
    login_count: Number(row.login_count) || 0,
  }));
}

export async function absensiLoginWeb({ mode = 'harian', startTime, endTime } = {}) {
  if (mode === 'bulanan') {
    const { start, end } = resolveMonthlyRange({ startTime, endTime });
    const polresRows = await fetchPolresLoginRecap({ startTime: start, endTime: end });
    const salam = getGreeting();
    const monthLabel = formatMonthYear(start);

    const totalPolres = polresRows.length;
    const totalOperators = polresRows.reduce((sum, row) => sum + row.operator_count, 0);
    const totalLogin = polresRows.reduce((sum, row) => sum + row.login_count, 0);

    const lines = [
      salam,
      '',
      'Mohon ijin Komandan,',
      '',
      'Frekuensi login operator berbanding lurus dengan efektivitas pemanfaatan dashboard, baik untuk absensi, monitoring, pengawasan real-time, maupun capaian likes/komentar.',
      '',
      '📊 Rekap Absensi Login Web Cicero (Bulanan)',
      `Periode: ${monthLabel}`,
      `Total login: ${formatNumber(totalLogin)}`,
      `Total operator aktif: ${formatNumber(totalOperators)} orang`,
      `Polres terlapor: ${formatNumber(totalPolres)} satuan`,
      '',
    ];

    if (!polresRows.length) {
      lines.push('Belum ada aktivitas login web pada periode ini.');
      return lines.join('\n').trim();
    }

    lines.push('Rincian per Polres:');

    const sortedPolres = [...polresRows].sort((a, b) => {
      const diff = b.login_count - a.login_count;
      if (diff !== 0) return diff;
      return String(a.nama || a.client_id || '').localeCompare(
        String(b.nama || b.client_id || ''),
        'id-ID',
        { sensitivity: 'base' }
      );
    });

    sortedPolres.forEach((row, idx) => {
      const name = (row.nama || row.client_id || '-').toString().toUpperCase();
      const operatorLabel = `${formatNumber(row.operator_count)} operator`;
      const loginLabel = `${formatNumber(row.login_count)} login`;
      lines.push(`${idx + 1}. ${name} — ${operatorLabel} | ${loginLabel}`);
    });

    return lines.join('\n').trim();
  }

  const { start, end, mode: normalizedMode } = resolveRange({ mode, startTime, endTime });
  const recapRows = await getWebLoginCountsByActor({ startTime: start, endTime: end });
  const actorIds = recapRows.map((row) => row.actor_id).filter(Boolean);
  const detailMap = await fetchActorDetails(actorIds);

  const totalParticipants = recapRows.length;
  const totalLogin = recapRows.reduce((sum, row) => sum + (Number(row.login_count) || 0), 0);

  const header = normalizedMode === 'mingguan'
    ? '🗓️ Rekap Login Web (Mingguan)'
    : '🗓️ Rekap Login Web (Harian)';
  const lines = [
    header,
    `Periode: ${formatDate(start)} - ${formatDate(end)}`,
    `Total hadir: ${formatNumber(totalParticipants)} user (${formatNumber(totalLogin)} login)`
  ];

  if (!recapRows.length) {
    lines.push('Tidak ada login web pada periode ini.');
    return lines.join('\n');
  }

  const sortedRows = [...recapRows].sort((a, b) => {
    const diff = (Number(b.login_count) || 0) - (Number(a.login_count) || 0);
    if (diff !== 0) return diff;
    return String(a.actor_id || '').localeCompare(String(b.actor_id || ''), 'id-ID', {
      sensitivity: 'base'
    });
  });

  sortedRows.forEach((row, idx) => {
    const detail = detailMap.get(row.actor_id) || {};
    const name = detail.username || detail.nama || row.actor_id || '-';
    const roleLabel = detail.role ? ` - ${String(detail.role).toUpperCase()}` : '';
    const sourceLabel = detail.source ? detail.source : 'unknown';
    lines.push(
      `${idx + 1}. ${name} (${sourceLabel}${roleLabel}) — ${formatNumber(row.login_count)} kali`
    );
  });

  return lines.join('\n');
}

export default absensiLoginWeb;
