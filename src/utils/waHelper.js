// src/utils/waHelper.js

export const minPhoneDigitLength = 8;

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function normalizeWhatsappNumber(phoneNumber) {
  if (!phoneNumber) return null;
  const normalized = onlyDigits(phoneNumber);
  if (normalized.length < minPhoneDigitLength) return null;
  return normalized;
}

export function formatToWhatsAppId(phoneNumber) {
  const normalized = normalizeWhatsappNumber(phoneNumber);
  return normalized ? `${normalized}@c.us` : '';
}

export function normalizeUserWhatsAppId(whatsappId) {
  if (!whatsappId) return '';
  const str = String(whatsappId).trim();

  if (str.endsWith('@c.us') || str.endsWith('@s.whatsapp.net') || str.endsWith('@g.us')) {
    return str;
  }

  const normalized = normalizeWhatsappNumber(str);
  return normalized ? `${normalized}@c.us` : '';
}

export function isAdminWhatsApp(candidate) {
  const admin = onlyDigits(process.env.ADMIN_WHATSAPP || '');
  const incoming = onlyDigits(candidate);
  return Boolean(admin && incoming && admin === incoming);
}

export function isUnsupportedVersionError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('please update whatsapp') ||
    message.includes('unsupported') ||
    message.includes('not supported version')
  );
}

function isLidMissingError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('lid is missing');
}

function isRetryableError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status > 0 && status < 500) return false;

  const message = String(error?.message || error || '').toLowerCase();
  if (
    message.includes('invalid parameter') ||
    message.includes('not registered') ||
    message.includes('forbidden')
  ) {
    return false;
  }

  return true;
}

async function waitForClientReady(waClient) {
  if (!waClient) return;

  if (typeof waClient.waitForWaReady === 'function') {
    await waClient.waitForWaReady();
    return;
  }

  if (typeof waClient.getState === 'function' && typeof waClient.once === 'function') {
    const state = await waClient.getState();
    if (state && state !== 'CONNECTED' && state !== 'READY') {
      await Promise.race([
        new Promise((resolve) => waClient.once('ready', resolve)),
        sleep(500),
      ]);
    }
  }
}

async function resolveRecipient(waClient, recipient) {
  const raw = String(recipient || '').trim();
  if (!raw) return '';

  if (raw.endsWith('@g.us')) {
    return raw;
  }

  if (raw.endsWith('@c.us') || raw.endsWith('@s.whatsapp.net')) {
    if (typeof waClient?.onWhatsApp === 'function') {
      const matches = await waClient.onWhatsApp(raw);
      const first = Array.isArray(matches) ? matches[0] : null;
      if (first?.exists && first?.jid) return first.jid;
    }
    return raw;
  }

  const normalized = normalizeWhatsappNumber(raw);
  if (!normalized) return '';

  if (typeof waClient?.getNumberId === 'function') {
    const numberId = await waClient.getNumberId(normalized);
    const jid = numberId?.id?._serialized || numberId?._serialized || numberId?.user || numberId?.jid;
    if (jid) return jid;
  }

  if (typeof waClient?.getContact === 'function') {
    const contact = await waClient.getContact(normalized);
    const jid = contact?.id?._serialized || contact?._serialized;
    if (jid) return jid;
  }

  return '';
}

async function hydrateChat(waClient, chatId) {
  if (typeof waClient?.getChat !== 'function' || !chatId) return;
  try {
    await waClient.getChat(chatId);
  } catch {
    // best effort only
  }
}

export async function safeSendMessage(waClient, chatId, message, options = {}) {
  const retry = options.retry || {};
  const maxAttempts = Number(retry.maxAttempts ?? 3);
  const baseDelayMs = Number(retry.baseDelayMs ?? 250);
  const maxLidRetries = Number(retry.maxLidRetries ?? 2);
  const lidRetryDelayMs = Number(retry.lidRetryDelayMs ?? 150);
  const messageOptions = options.messageOptions || {};

  const resolvedChatId = await resolveRecipient(waClient, chatId);
  if (!resolvedChatId) return false;

  await hydrateChat(waClient, resolvedChatId);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await waitForClientReady(waClient);
      await waClient.sendMessage(resolvedChatId, message, messageOptions);
      return true;
    } catch (error) {
      if (isLidMissingError(error)) {
        for (let lidAttempt = 0; lidAttempt < maxLidRetries; lidAttempt += 1) {
          await sleep(lidRetryDelayMs);
          await hydrateChat(waClient, resolvedChatId);
          try {
            await waClient.sendMessage(resolvedChatId, message, messageOptions);
            return true;
          } catch (lidError) {
            if (!isLidMissingError(lidError)) {
              if (!isRetryableError(lidError)) return false;
              break;
            }
            if (lidAttempt === maxLidRetries - 1) return false;
          }
        }
      }

      if (!isRetryableError(error)) {
        return false;
      }

      if (attempt >= maxAttempts) {
        return false;
      }

      await sleep(baseDelayMs * attempt);
    }
  }

  return false;
}

export async function sendWAFile(
  waClient,
  buffer,
  fileName,
  recipient,
  mimetype,
) {
  if (!waClient?.sendMessage) {
    throw new Error('waClient.sendMessage is required');
  }

  const target = await resolveRecipient(waClient, recipient);
  if (!target) {
    throw new Error('Recipient not found on WhatsApp');
  }

  let resolvedMime = mimetype;
  if (!resolvedMime && String(fileName || '').toLowerCase().endsWith('.xls')) {
    resolvedMime = 'application/vnd.ms-excel';
  }
  if (!resolvedMime && String(fileName || '').toLowerCase().endsWith('.xlsx')) {
    resolvedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  return waClient.sendMessage(target, {
    document: buffer,
    mimetype: resolvedMime || 'application/octet-stream',
    fileName,
  });
}
