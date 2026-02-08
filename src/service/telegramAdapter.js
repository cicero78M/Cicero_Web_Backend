import { EventEmitter } from 'events';
import TelegramBot from 'node-telegram-bot-api';

/**
 * Create a Telegram bot client with event-based interface
 * @param {string} token - Telegram bot token
 * @returns {Promise<EventEmitter>} EventEmitter with Telegram bot methods
 */
export async function createTelegramClient(token) {
  if (!token) {
    throw new Error('[TELEGRAM] Bot token is required');
  }

  const emitter = new EventEmitter();
  let bot = null;
  let isConnected = false;

  /**
   * Initialize the Telegram bot
   */
  async function initialize() {
    try {
      console.log('[TELEGRAM] Initializing bot...');
      
      bot = new TelegramBot(token, { polling: true });
      
      // Test connection by getting bot info
      const me = await bot.getMe();
      isConnected = true;
      
      console.log(`[TELEGRAM] Bot connected: @${me.username} (${me.first_name})`);
      emitter.emit('ready', { username: me.username, id: me.id });
      
      // Handle incoming messages
      bot.on('message', (msg) => {
        console.log(`[TELEGRAM] Message received from ${msg.from.username || msg.from.id}: ${msg.text}`);
        emitter.emit('message', msg);
      });
      
      // Handle errors
      bot.on('polling_error', (error) => {
        console.error('[TELEGRAM] Polling error:', error.message);
        emitter.emit('error', error);
      });
      
      bot.on('error', (error) => {
        console.error('[TELEGRAM] Bot error:', error.message);
        emitter.emit('error', error);
      });
      
      return bot;
    } catch (error) {
      console.error('[TELEGRAM] Failed to initialize bot:', error.message);
      isConnected = false;
      emitter.emit('error', error);
      throw error;
    }
  }

  /**
   * Send a message to a chat
   * @param {string|number} chatId - Chat ID to send message to
   * @param {string} message - Message text
   * @param {object} options - Additional options (parse_mode, etc.)
   */
  emitter.sendMessage = async function(chatId, message, options = {}) {
    if (!bot || !isConnected) {
      throw new Error('[TELEGRAM] Bot not connected');
    }
    
    try {
      const result = await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        ...options
      });
      console.log(`[TELEGRAM] Message sent to ${chatId}`);
      return result;
    } catch (error) {
      console.error(`[TELEGRAM] Failed to send message to ${chatId}:`, error.message);
      throw error;
    }
  };

  /**
   * Get bot information
   */
  emitter.getMe = async function() {
    if (!bot) {
      throw new Error('[TELEGRAM] Bot not initialized');
    }
    return await bot.getMe();
  };

  /**
   * Check if bot is connected
   */
  emitter.isReady = function() {
    return isConnected;
  };

  /**
   * Stop the bot
   */
  emitter.destroy = async function() {
    if (bot) {
      console.log('[TELEGRAM] Stopping bot...');
      await bot.stopPolling();
      bot = null;
      isConnected = false;
      emitter.emit('disconnected');
    }
  };

  // Initialize the bot
  await initialize();

  return emitter;
}
