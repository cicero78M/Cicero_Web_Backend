const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

export { DEFAULT_TIMEZONE };

export const REJECTION_REASONS = [
  'Penggunaan username dan role tidak sesuai',
  'Penggunaan username tidak sesuai',
  'Role tidak sesuai',
  'Wilayah tidak sesuai',
];

export function escapeMarkdown(text) {
  if (!text) return '';

  const str = String(text);
  return str
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

export function formatCurrencyId(amount) {
  if (!amount) return 'Rp 0';
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `Rp ${amount}`;
  }
}

export function buildDashboardPendingListMessage(users = []) {
  if (!users.length) {
    return '📭 Tidak ada dashboard user pending saat ini.';
  }

  const lines = users.map((user, index) => {
    const username = user.username || '-';
    const createdAt = user.created_at
      ? new Date(user.created_at).toLocaleString('id-ID', { timeZone: DEFAULT_TIMEZONE })
      : '-';
    const clientIds = Array.isArray(user.client_ids)
      ? user.client_ids.join(', ')
      : user.client_ids || '-';

    return (
      `${index + 1}. *${escapeMarkdown(username)}*\n` +
      `   • Dashboard User ID: \`${escapeMarkdown(user.dashboard_user_id || '-')}\`\n` +
      `   • Role: ${escapeMarkdown(user.role || '-')}\n` +
      `   • Client IDs: ${escapeMarkdown(clientIds || '-')}\n` +
      `   • Dibuat: ${escapeMarkdown(createdAt)}\n` +
      `   • Action: \`/approvedash ${escapeMarkdown(username)}\` atau ` +
      `\`/denydash ${escapeMarkdown(username)}\``
    );
  });

  return `📋 *Dashboard User Pending*\n\n${lines.join('\n\n')}`;
}

export function buildPremiumPendingListMessage(requests = []) {
  if (!requests.length) {
    return '📭 Tidak ada premium request pending/confirmed saat ini.';
  }

  const lines = requests.map((request, index) => (
    `${index + 1}. *${escapeMarkdown(request.username || '-')}* (${escapeMarkdown(request.status || '-')})\n` +
    `   • Token: \`${escapeMarkdown(request.request_token || '-')}\`\n` +
    `   • Tier: ${escapeMarkdown(request.premium_tier || '-')}\n` +
    `   • Nominal: ${escapeMarkdown(formatCurrencyId(request.transfer_amount))}\n` +
    `   • Dibuat: ${escapeMarkdown(new Date(request.created_at).toLocaleString('id-ID', { timeZone: DEFAULT_TIMEZONE }))}`
  ));

  return `📋 *Premium Pending Requests*\n\n${lines.join('\n\n')}`;
}
