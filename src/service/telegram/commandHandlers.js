import {
  buildDashboardPendingListMessage as buildDashboardPendingListMessageFormatter,
  escapeMarkdown,
} from './formatters.js';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSlashCommandPattern(commandName) {
  const escapedCommandName = escapeRegExp(commandName);
  return `/${escapedCommandName}(?:@[A-Za-z0-9_]+)?`;
}

export function parseDashboardCommandText(text, commandName) {
  if (!text || !commandName) {
    return null;
  }

  const trimmedText = String(text).trim();
  const slashCommandPattern = new RegExp(
    `^${getSlashCommandPattern(commandName)}(?:\\s+([^\\s#]+)|#([^\\s#]+))?\\s*$`,
  );
  const legacyHashPattern = new RegExp(`^${escapeRegExp(commandName)}#([^\\s#]+)\\s*$`);
  const slashMatch = trimmedText.match(slashCommandPattern);

  if (slashMatch) {
    return slashMatch[1] || slashMatch[2] || null;
  }

  const legacyHashMatch = trimmedText.match(legacyHashPattern);

  if (legacyHashMatch) {
    return legacyHashMatch[1];
  }

  return null;
}

const approveDashFormatMessage =
  '❌ Format salah. Gunakan: `/approvedash username` atau `approvedash#username`';
const denyDashFormatMessage = '❌ Format salah. Gunakan: `/denydash username` atau `denydash#username`';

export function createTelegramCommandHandlers({
  getBot,
  isTelegramAdmin,
  processApproval,
  processRejection,
  processPremiumApproval,
  processPremiumDenial,
  handlePremiumPendingCommand,
  findPendingDashboardUsers,
  buildDashboardPendingListMessage = buildDashboardPendingListMessageFormatter,
}) {
  async function handleApprovePremiumCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    const token = msg.text.split(' ')[1];
    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }
    if (!token) {
      await bot.sendMessage(chatId, '❌ Format salah. Gunakan: `/approvepremium request_token`', {
        parse_mode: 'Markdown',
      });
      return;
    }
    await processPremiumApproval(chatId, token);
  }

  async function handleDenyPremiumCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    const token = msg.text.split(' ')[1];
    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }
    if (!token) {
      await bot.sendMessage(chatId, '❌ Format salah. Gunakan: `/denypremium request_token`', {
        parse_mode: 'Markdown',
      });
      return;
    }
    await processPremiumDenial(chatId, token);
  }

  async function handleApproveDashCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    const username = parseDashboardCommandText(msg.text, 'approvedash');

    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }

    if (!username) {
      await bot.sendMessage(chatId, approveDashFormatMessage, {
        parse_mode: 'Markdown',
      });
      return;
    }

    await processApproval(chatId, username);
  }

  async function handleDenyDashCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    const username = parseDashboardCommandText(msg.text, 'denydash');

    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }

    if (!username) {
      await bot.sendMessage(chatId, denyDashFormatMessage, {
        parse_mode: 'Markdown',
      });
      return;
    }

    await processRejection(chatId, username);
  }


  async function handleDashPendingCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;

    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }

    try {
      const loadPendingDashboardUsers = findPendingDashboardUsers ||
        (await import('../../model/dashboardUserModel.js')).findPendingDashboardUsers;
      const pendingUsers = await loadPendingDashboardUsers(20);
      await bot.sendMessage(chatId, buildDashboardPendingListMessage(pendingUsers), {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await bot.sendMessage(
        chatId,
        `❌ Gagal mengambil dashboard user pending: ${escapeMarkdown(err.message)}`,
      );
    }
  }

  async function handleStartCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    if (isTelegramAdmin(chatId)) {
      await bot.sendMessage(
        chatId,
        'Selamat datang di Cicero Admin Bot!\n\n' +
          'Perintah yang tersedia:\n' +
          '/approvedash <username> - Setujui registrasi user\n' +
          '/denydash <username> - Tolak registrasi user\n' +
          '/approvepremium <request_token> - Setujui premium request\n' +
          '/denypremium <request_token> - Tolak premium request\n' +
          '/premiumpending - Lihat daftar premium pending\n' +
          '/dashpending atau /pendingdash - Lihat dashboard user pending',
      );
    } else {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    }
  }

  function setupCommandHandlers() {
    const bot = getBot();
    if (!bot) return;

    bot.onText(
      new RegExp(`^(?:${getSlashCommandPattern('approvedash')}(?:\\s+[^\\s#]+|#[^\\s#]+)?|approvedash#[^\\s#]+)\\s*$`),
      handleApproveDashCommand,
    );
    bot.onText(
      new RegExp(`^(?:${getSlashCommandPattern('denydash')}(?:\\s+[^\\s#]+|#[^\\s#]+)?|denydash#[^\\s#]+)\\s*$`),
      handleDenyDashCommand,
    );
    bot.onText(/\/approvepremium/, handleApprovePremiumCommand);
    bot.onText(/\/denypremium/, handleDenyPremiumCommand);
    bot.onText(/\/premiumpending/, handlePremiumPendingCommand);
    bot.onText(/^\/(?:dashpending|pendingdash)\b/, handleDashPendingCommand);
    bot.onText(/\/start/, handleStartCommand);

    console.log('[Telegram] Command handlers registered');
  }

  return {
    handleApprovePremiumCommand,
    handleDenyPremiumCommand,
    handleApproveDashCommand,
    handleDenyDashCommand,
    handleDashPendingCommand,
    handleStartCommand,
    setupCommandHandlers,
  };
}
