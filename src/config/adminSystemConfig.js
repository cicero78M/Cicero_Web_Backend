function parseCsv(value = '') {
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseRoleMap(raw = '{}') {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export const ADMIN_SYSTEM_CONFIG_ALLOWLIST = new Set([
  'JWT_SECRET',
  'ADMIN_SYSTEM_OTP_TTL_SECONDS',
  'ADMIN_SYSTEM_SESSION_TTL_SECONDS',
  'ADMIN_SYSTEM_PAGINATION_DEFAULT_LIMIT',
  'ADMIN_SYSTEM_PAGINATION_MAX_LIMIT',
  'ADMIN_SYSTEM_TIMEZONE',
  'ADMIN_SYSTEM_ROLE_MAP',
  'TELEGRAM_ADMIN_CHAT_ID',
]);

export function getAdminSystemConfig({ env } = {}) {
  const source = env || process.env;
  const otpTtlSeconds = parsePositiveInt(source.ADMIN_SYSTEM_OTP_TTL_SECONDS, 300);
  const sessionTtlSeconds = parsePositiveInt(source.ADMIN_SYSTEM_SESSION_TTL_SECONDS, 7200);
  const paginationDefaultLimit = parsePositiveInt(source.ADMIN_SYSTEM_PAGINATION_DEFAULT_LIMIT, 20);
  const paginationMaxLimit = parsePositiveInt(source.ADMIN_SYSTEM_PAGINATION_MAX_LIMIT, 100);
  const timezone = String(source.ADMIN_SYSTEM_TIMEZONE || 'Asia/Jakarta').trim() || 'Asia/Jakarta';

  const adminChatIds = parseCsv(source.TELEGRAM_ADMIN_CHAT_ID || '');
  const roleMap = parseRoleMap(source.ADMIN_SYSTEM_ROLE_MAP || '{}');

  return {
    otpTtlSeconds,
    sessionTtlSeconds,
    paginationDefaultLimit,
    paginationMaxLimit,
    timezone,
    adminChatIds,
    roleMap,
  };
}

export const ADMIN_SYSTEM_CRITICAL_KEYS = new Set(['JWT_SECRET', 'TELEGRAM_ADMIN_CHAT_ID', 'ADMIN_SYSTEM_ROLE_MAP']);

export function isCriticalAdminSystemConfigKey(configKey) {
  return ADMIN_SYSTEM_CRITICAL_KEYS.has(String(configKey || '').trim());
}

export function validateConfigKeyValue(configKey, configValue) {
  const key = String(configKey || '').trim();
  if (!ADMIN_SYSTEM_CONFIG_ALLOWLIST.has(key)) {
    return { ok: false, message: 'config_key tidak diizinkan' };
  }

  if (key === 'ADMIN_SYSTEM_OTP_TTL_SECONDS' || key === 'ADMIN_SYSTEM_SESSION_TTL_SECONDS' || key === 'ADMIN_SYSTEM_PAGINATION_DEFAULT_LIMIT' || key === 'ADMIN_SYSTEM_PAGINATION_MAX_LIMIT') {
    const n = Number(configValue);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, message: `${key} harus angka positif` };
    }
  }

  if (key === 'JWT_SECRET') {
    if (String(configValue || '').trim().length < 16) {
      return { ok: false, message: 'JWT_SECRET minimal 16 karakter' };
    }
  }

  if (key === 'ADMIN_SYSTEM_ROLE_MAP') {
    try {
      const parsed = JSON.parse(String(configValue));
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, message: 'ADMIN_SYSTEM_ROLE_MAP harus JSON object' };
      }
    } catch {
      return { ok: false, message: 'ADMIN_SYSTEM_ROLE_MAP harus JSON valid' };
    }
  }

  return { ok: true };
}

export function analyzeAdminSystemConfig(cfg = getAdminSystemConfig()) {
  const issues = [];
  const warnings = [];

  if (!cfg.adminChatIds.length) {
    issues.push('TELEGRAM_ADMIN_CHAT_ID kosong');
  }
  if (cfg.otpTtlSeconds > 900) {
    warnings.push('OTP TTL lebih dari 15 menit (disarankan <= 900 detik)');
  }
  if (cfg.sessionTtlSeconds > 12 * 3600) {
    warnings.push('Session TTL lebih dari 12 jam (risiko sesi terlalu panjang)');
  }
  if (cfg.paginationMaxLimit > 500) {
    warnings.push('Pagination max limit terlalu besar (potensi beban query tinggi)');
  }

  const roleEntries = Object.entries(cfg.roleMap || {});
  const invalidRoleEntries = roleEntries.filter(([, role]) => !['super_admin', 'finance_admin', 'auditor'].includes(String(role)));
  if (invalidRoleEntries.length > 0) {
    warnings.push('ADMIN_SYSTEM_ROLE_MAP berisi role tidak dikenal');
  }

  const orphanRoleMappings = roleEntries.filter(([chatId]) => !cfg.adminChatIds.includes(String(chatId)));
  if (orphanRoleMappings.length > 0) {
    warnings.push('Ada role map untuk chat_id yang tidak ada di TELEGRAM_ADMIN_CHAT_ID');
  }

  return {
    healthy: issues.length === 0,
    issues,
    warnings,
    riskLevel: issues.length > 0 ? 'high' : warnings.length > 0 ? 'medium' : 'low',
  };
}
