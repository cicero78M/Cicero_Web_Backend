export function extractInstagramUsername(value) {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  const match = trimmed.match(
    /^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(\?.*)?$/i
  );
  const username = match ? match[2] : trimmed.replace(/^@/, '');
  const normalized = username?.toLowerCase();
  if (!normalized || !/^[a-z0-9._]{1,30}$/.test(normalized)) return null;
  return normalized;
}

export function extractTiktokUsername(value) {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  const match = trimmed.match(
    /^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9._]+)\/?(\?.*)?$/i
  );
  const username = match ? match[2] : trimmed.replace(/^@/, '');
  const normalized = username?.toLowerCase();
  if (!normalized || !/^[a-z0-9._]{1,24}$/.test(normalized)) return null;
  return `@${normalized}`;
}
