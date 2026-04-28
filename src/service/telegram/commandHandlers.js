export function createTelegramCommandHandlers({
  getBot,
  isTelegramAdmin,
  processApproval,
  processRejection,
  processPremiumApproval,
  processPremiumDenial,
  handlePremiumPendingCommand,
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
    const username = msg.text.split(' ')[1];

    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }

    if (!username) {
      await bot.sendMessage(chatId, '❌ Format salah. Gunakan: `/approvedash username`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    await processApproval(chatId, username);
  }

  async function handleDenyDashCommand(msg) {
    const bot = getBot();
    const chatId = msg.chat.id;
    const username = msg.text.split(' ')[1];

    if (!isTelegramAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
      return;
    }

    if (!username) {
      await bot.sendMessage(chatId, '❌ Format salah. Gunakan: `/denydash username`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    await processRejection(chatId, username);
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
          '/premiumpending - Lihat daftar premium pending',
      );
    } else {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    }
  }

  function setupCommandHandlers() {
    const bot = getBot();
    if (!bot) return;

    bot.onText(/\/approvedash/, handleApproveDashCommand);
    bot.onText(/\/denydash/, handleDenyDashCommand);
    bot.onText(/\/approvepremium/, handleApprovePremiumCommand);
    bot.onText(/\/denypremium/, handleDenyPremiumCommand);
    bot.onText(/\/premiumpending/, handlePremiumPendingCommand);
    bot.onText(/\/start/, handleStartCommand);

    console.log('[Telegram] Command handlers registered');
  }

  return {
    handleApprovePremiumCommand,
    handleDenyPremiumCommand,
    handleApproveDashCommand,
    handleDenyDashCommand,
    handleStartCommand,
    setupCommandHandlers,
  };
}
