import fs from 'fs';
import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

// Enable debug logging only when WA_DEBUG_LOGGING is set to "true"
const debugLoggingEnabled = process.env.WA_DEBUG_LOGGING === 'true';

const DEFAULT_AUTH_DATA_DIR = 'baileys_auth';
const DEFAULT_AUTH_DATA_PARENT_DIR = '.cicero';
const DEFAULT_CONNECT_TIMEOUT_MS = 180000;
const DEFAULT_CONNECT_RETRY_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_BACKOFF_MS = 5000;

/**
 * Resolve the default path for auth data storage
 * @returns {string} Default auth data path
 */
function resolveDefaultAuthDataPath() {
  const homeDir = os.homedir?.();
  const baseDir = homeDir || process.cwd();
  return path.resolve(
    path.join(baseDir, DEFAULT_AUTH_DATA_PARENT_DIR, DEFAULT_AUTH_DATA_DIR)
  );
}

/**
 * Resolve auth data path from environment or use default
 * @returns {string} Auth data path
 */
function resolveAuthDataPath() {
  const configuredPath = (process.env.WA_AUTH_DATA_PATH || '').trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return resolveDefaultAuthDataPath();
}

/**
 * Check if auth session should be cleared on initialization
 * @returns {boolean} Whether to clear session
 */
function shouldClearAuthSession() {
  return process.env.WA_AUTH_CLEAR_SESSION_ON_REINIT === 'true';
}

/**
 * Create a Baileys WhatsApp client with the same interface as wwebjsAdapter
 * @param {string} clientId - Unique client identifier (default: 'wa-admin')
 * @returns {Promise<EventEmitter>} EventEmitter with WhatsApp client methods
 */
export async function createBaileysClient(clientId = 'wa-admin') {
  const emitter = new EventEmitter();
  
  // Configure logging based on debug flag
  const logger = pino({
    level: debugLoggingEnabled ? 'debug' : 'warn',
  });

  // Resolve auth path
  const baseAuthPath = resolveAuthDataPath();
  const sessionPath = path.join(baseAuthPath, `session-${clientId}`);
  
  // Clear session if requested
  const clearAuthSession = shouldClearAuthSession();
  if (clearAuthSession) {
    try {
      await rm(sessionPath, { recursive: true, force: true });
      console.log(`[BAILEYS] Cleared auth session for clientId=${clientId}`);
    } catch (err) {
      console.warn(`[BAILEYS] Failed to clear auth session:`, err?.message || err);
    }
  }

  // Ensure session directory exists
  await mkdir(sessionPath, { recursive: true });

  // Initialize auth state
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // Get latest Baileys version
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[BAILEYS] Using version ${version.join('.')}, isLatest: ${isLatest}`);

  let sock = null;
  let connectInProgress = null;
  let connectStartedAt = null;
  let isConnected = false;

  /**
   * Start connection with retry logic
   * @param {string} triggerLabel - Label for logging
   * @returns {Promise<void>}
   */
  async function startConnect(triggerLabel = 'connect') {
    if (connectInProgress) {
      console.log(`[BAILEYS] Connect already in progress for clientId=${clientId}`);
      return connectInProgress;
    }

    connectStartedAt = Date.now();
    let attempts = 0;
    const maxAttempts = DEFAULT_CONNECT_RETRY_ATTEMPTS;

    connectInProgress = (async () => {
      while (attempts < maxAttempts) {
        attempts++;
        try {
          console.log(
            `[BAILEYS] Connecting clientId=${clientId} (attempt ${attempts}/${maxAttempts}, trigger=${triggerLabel})`
          );

          // Create a promise that will be resolved when connection is open
          const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Connection timeout'));
            }, DEFAULT_CONNECT_TIMEOUT_MS);

            // Create socket
            sock = makeWASocket({
              version,
              logger,
              printQRInTerminal: false,
              auth: state,
              connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              defaultQueryTimeoutMs: undefined,
              emitOwnEvents: true,
              browser: ['Cicero', 'Chrome', '120.0.0'],
            });

            // Handle connection updates
            sock.ev.on('connection.update', async (update) => {
              const { connection, lastDisconnect, qr } = update;

              if (qr) {
                console.log(`[BAILEYS] QR Code received for clientId=${clientId}`);
                qrcode.generate(qr, { small: true });
                emitter.emit('qr', qr);
              }

              if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(
                  `[BAILEYS] Connection closed for clientId=${clientId}, statusCode=${statusCode}, shouldReconnect=${shouldReconnect}`
                );

                isConnected = false;
                clearTimeout(timeout);
                
                // Map disconnect reason
                let reason = 'UNKNOWN';
                if (statusCode === DisconnectReason.loggedOut) {
                  reason = 'LOGGED_OUT';
                } else if (statusCode === DisconnectReason.restartRequired) {
                  reason = 'RESTART_REQUIRED';
                } else if (statusCode === DisconnectReason.connectionClosed) {
                  reason = 'CONNECTION_CLOSED';
                } else if (statusCode === DisconnectReason.connectionLost) {
                  reason = 'CONNECTION_LOST';
                } else if (statusCode === DisconnectReason.timedOut) {
                  reason = 'TIMED_OUT';
                }

                emitter.emit('disconnected', reason);

                if (shouldReconnect && attempts < maxAttempts) {
                  reject(new Error(`Connection closed: ${reason}`));
                } else {
                  reject(new Error(`Connection failed: ${reason}`));
                }
              } else if (connection === 'open') {
                console.log(`[BAILEYS] Connection opened for clientId=${clientId}`);
                isConnected = true;
                clearTimeout(timeout);
                emitter.emit('ready');
                resolve();
              }
            });

            // Handle credential updates
            sock.ev.on('creds.update', saveCreds);

            // Handle incoming messages
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
              if (type !== 'notify') return;

              for (const msg of messages) {
                if (msg.key.fromMe) continue; // Skip own messages

                // Extract message content
                const messageContent = msg.message;
                let body = '';

                if (messageContent?.conversation) {
                  body = messageContent.conversation;
                } else if (messageContent?.extendedTextMessage?.text) {
                  body = messageContent.extendedTextMessage.text;
                } else if (messageContent?.imageMessage?.caption) {
                  body = messageContent.imageMessage.caption;
                } else if (messageContent?.videoMessage?.caption) {
                  body = messageContent.videoMessage.caption;
                }

                // Emit message event with wwebjs-compatible format
                emitter.emit('message', {
                  from: msg.key.remoteJid,
                  body: body,
                  id: msg.key.id,
                  author: msg.key.participant || msg.key.remoteJid,
                  timestamp: msg.messageTimestamp,
                  hasMedia: !!(
                    messageContent?.imageMessage ||
                    messageContent?.videoMessage ||
                    messageContent?.audioMessage ||
                    messageContent?.documentMessage
                  ),
                  isGroup: msg.key.remoteJid?.endsWith('@g.us') || false,
                });
              }
            });
          });

          // Wait for connection to establish
          await connectionPromise;
          break; // Connection successful, exit retry loop
        } catch (err) {
          console.error(
            `[BAILEYS] Connect attempt ${attempts}/${maxAttempts} failed for clientId=${clientId}:`,
            err?.message || err
          );

          if (attempts >= maxAttempts) {
            console.error(`[BAILEYS] Max connect attempts reached for clientId=${clientId}`);
            throw err;
          }

          // Backoff before retry
          const backoff = DEFAULT_CONNECT_RETRY_BACKOFF_MS * attempts;
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    })();

    await connectInProgress;
    connectInProgress = null;
    return;
  }

  // Public API methods
  emitter.connect = async () => startConnect('connect');

  emitter.reinitialize = async (options = {}) => {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const hasClearAuthSession = typeof safeOptions.clearAuthSession === 'boolean';
    const clearAuthSessionOverride = hasClearAuthSession
      ? safeOptions.clearAuthSession
      : shouldClearAuthSession();

    if (clearAuthSessionOverride) {
      try {
        await rm(sessionPath, { recursive: true, force: true });
        console.log(`[BAILEYS] Cleared auth session during reinitialize for clientId=${clientId}`);
      } catch (err) {
        console.warn(`[BAILEYS] Failed to clear auth session:`, err?.message || err);
      }
    }

    if (sock) {
      await sock.logout();
      sock = null;
    }

    isConnected = false;
    await startConnect('reinitialize');
  };

  emitter.disconnect = async () => {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    isConnected = false;
  };

  emitter.getNumberId = async (phone) => {
    if (!sock || !isConnected) {
      console.warn('[BAILEYS] getNumberId: socket not ready');
      return null;
    }

    try {
      const [result] = await sock.onWhatsApp(phone);
      return result?.jid || null;
    } catch (err) {
      console.warn('[BAILEYS] getNumberId failed:', err?.message || err);
      return null;
    }
  };

  emitter.getChat = async (jid) => {
    const normalizedJid = typeof jid === 'string' ? jid.trim() : '';
    if (!normalizedJid) {
      console.warn('[BAILEYS] getChat skipped: jid kosong atau tidak valid.');
      return null;
    }

    if (!sock || !isConnected) {
      console.warn('[BAILEYS] getChat: socket not ready');
      return null;
    }

    try {
      // Return a basic chat object
      return {
        id: {
          _serialized: normalizedJid,
        },
        name: normalizedJid,
      };
    } catch (err) {
      console.warn('[BAILEYS] getChat failed:', err?.message || err);
      return null;
    }
  };

  emitter.sendMessage = async (jid, content, options = {}) => {
    if (!sock || !isConnected) {
      throw new Error('Socket not ready');
    }

    const safeOptions = options && typeof options === 'object' ? options : {};

    try {
      let sentMsg;

      if (content && typeof content === 'object' && 'document' in content) {
        // Send document
        sentMsg = await sock.sendMessage(jid, {
          document: content.document,
          mimetype: content.mimetype || 'application/octet-stream',
          fileName: content.fileName || 'document',
        });
      } else {
        // Send text message
        const text = typeof content === 'string' ? content : content?.text ?? '';
        sentMsg = await sock.sendMessage(jid, { text });
      }

      // Mark as read if requested
      if (safeOptions.sendSeen) {
        await emitter.sendSeen(jid);
      }

      return sentMsg?.key?.id || '';
    } catch (err) {
      console.error('[BAILEYS] sendMessage failed:', err?.message || err);
      const error = new Error('sendMessage failed');
      error.jid = jid;
      error.retryable = false;
      throw error;
    }
  };

  emitter.sendSeen = async (jid) => {
    if (!sock || !isConnected) {
      console.warn('[BAILEYS] sendSeen: socket not ready');
      return;
    }

    try {
      await sock.readMessages([{ remoteJid: jid, id: '' }]);
    } catch (err) {
      console.warn('[BAILEYS] sendSeen failed:', err?.message || err);
    }
  };

  emitter.onMessage = (handler) => emitter.on('message', handler);
  emitter.onDisconnect = (handler) => emitter.on('disconnected', handler);

  emitter.isReady = async () => isConnected;

  emitter.getConnectPromise = () => connectInProgress;
  emitter.getConnectStartedAt = () => connectStartedAt;

  emitter.getState = async () => {
    if (isConnected) {
      return 'CONNECTED';
    }
    return 'DISCONNECTED';
  };

  emitter.sessionPath = sessionPath;
  emitter.fatalInitError = null;

  return emitter;
}
