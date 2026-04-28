import {
  clientRequestHandlers,
  parseComplaintMessage,
} from '../handler/menu/clientRequestHandlers.js';

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return digits;
}

function isGatewayForwardedByAdmin(text, senderId) {
  const normalizedText = String(text || '').trim().toLowerCase();
  if (!normalizedText.startsWith('wagateway forward')) return false;

  const senderPhone = normalizePhone(senderId);
  const adminPhones = String(process.env.GATEWAY_WHATSAPP_ADMIN || '')
    .split(',')
    .map((item) => normalizePhone(item))
    .filter(Boolean);

  return adminPhones.includes(senderPhone);
}

export function shouldHandleComplaintMessage({
  text,
  allowUserMenu,
  session,
  senderId,
}) {
  if (allowUserMenu) return false;
  if (session?.menu === 'clientrequest' && session?.step === 'respondComplaint_message') {
    return false;
  }
  if (isGatewayForwardedByAdmin(text, senderId)) return false;

  const normalizedText = String(text || '');
  if (!/pesan\s+komplain/i.test(normalizedText)) return false;

  const parsed = parseComplaintMessage(normalizedText);
  return Boolean(parsed?.nrp && Array.isArray(parsed?.issues) && parsed.issues.length > 0);
}

export async function handleComplaintMessageIfApplicable(context) {
  const {
    text,
    allowUserMenu,
    session,
    senderId,
    chatId,
    adminOptionSessions,
    setSession,
    getSession,
    waClient,
    pool,
    userModel,
  } = context;

  const shouldHandle = shouldHandleComplaintMessage({
    text,
    allowUserMenu,
    session,
    senderId,
  });

  if (!shouldHandle) return false;

  const currentAdminOption = adminOptionSessions?.[chatId];
  if (currentAdminOption?.timeout) {
    clearTimeout(currentAdminOption.timeout);
  }
  if (adminOptionSessions && chatId in adminOptionSessions) {
    delete adminOptionSessions[chatId];
  }

  setSession?.(chatId, {
    menu: 'clientrequest',
    step: 'respondComplaint_message',
    respondComplaint: {},
  });

  const activeSession = getSession?.(chatId) || {
    menu: 'clientrequest',
    step: 'respondComplaint_message',
    respondComplaint: {},
  };

  await clientRequestHandlers.respondComplaint_message(
    activeSession,
    waClient,
    chatId,
    pool,
    userModel
  );

  return true;
}

