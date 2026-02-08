# Telegram Bot Setup Guide

This guide explains how to set up the Telegram bot for receiving login logs and user approval notifications.

## Prerequisites

- A Telegram account
- Access to create a Telegram bot via @BotFather

## Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send the command `/newbot` to @BotFather
3. Follow the prompts:
   - Choose a name for your bot (e.g., "Cicero Admin Bot")
   - Choose a username for your bot (must end with 'bot', e.g., "cicero_admin_bot")
4. @BotFather will provide you with a bot token. **Save this token securely.**
   - Example: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

## Step 2: Get Your Chat ID

### For Personal Chat

1. Start a chat with your newly created bot
2. Send any message to the bot
3. Open this URL in your browser (replace `YOUR_BOT_TOKEN` with your actual token):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":` in the JSON response. The number after `id` is your chat ID.
   - Example: `"id":987654321`

### For Group Chat

1. Add your bot to a Telegram group
2. Send a message in the group
3. Use the same URL as above to get updates
4. Look for the chat ID in the response (it will be negative for groups)
   - Example: `"id":-987654321`

## Step 3: Configure Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Telegram Service Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_CHAT_ID=987654321

# Optional: Skip Telegram initialization for testing
# TELEGRAM_SERVICE_SKIP_INIT=false
```

**Important Notes:**
- `TELEGRAM_BOT_TOKEN`: The token you received from @BotFather
- `TELEGRAM_ADMIN_CHAT_ID`: Your personal chat ID or group chat ID
- For group chats, include the negative sign (e.g., `-987654321`)

## Step 4: Restart the Application

After adding the environment variables, restart your application:

```bash
npm start
```

Check the logs for successful initialization:
```
[Telegram] Bot initialized successfully (send-only mode)
```

## What Notifications You'll Receive

The Telegram bot will send the following notifications to the configured admin chat:

### 1. Login Notifications
When a user logs into the dashboard:
```
🔑 Login Dashboard

Username: testuser
Role: operator
Client ID: test-client
Tipe: operator
Sumber: web
Waktu: 08/02/2026 13:30:45
```

### 2. User Registration Requests
When a new user registers:
```
📋 Permintaan Registrasi Dashboard

User ID: user-123
Username: newuser
WhatsApp: 628123456789
Role: operator

Menunggu persetujuan admin
```

### 3. Approval Confirmations
When an admin approves a user:
```
✅ Registrasi Dashboard Disetujui

Username: approveduser
```

### 4. Rejection Confirmations
When an admin rejects a user:
```
❌ Registrasi Dashboard Ditolak

Username: rejecteduser
```

## Testing the Integration

### 1. Test Login Notification

```bash
curl -X POST http://localhost:3000/api/auth/dashboard-login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'
```

You should receive a Telegram notification after successful login.

### 2. Test Registration Notification

```bash
curl -X POST http://localhost:3000/api/auth/dashboard-register \
  -H "Content-Type: application/json" \
  -d '{
    "username":"newuser",
    "password":"testpass",
    "whatsapp":"628123456789"
  }'
```

You should receive a Telegram notification for the registration request.

## Troubleshooting

### Bot Not Sending Messages

1. **Check bot token**: Ensure `TELEGRAM_BOT_TOKEN` is correct
2. **Check chat ID**: Ensure `TELEGRAM_ADMIN_CHAT_ID` is correct
   - For groups, make sure the ID is negative
3. **Check bot permissions**: For groups, ensure the bot has permission to send messages
4. **Check logs**: Look for errors in application logs:
   ```
   [Telegram] Failed to send message: ...
   ```

### Bot Not Initialized

Check logs for:
```
[Telegram] Bot initialization skipped (no token or skip flag set)
```

This means either:
- `TELEGRAM_BOT_TOKEN` is not set
- `TELEGRAM_SERVICE_SKIP_INIT=true` is set (for testing)

### Message Format Issues

If messages appear without formatting:
- Telegram uses Markdown formatting
- Ensure special characters are escaped
- Check that the `parse_mode` is set to `Markdown`

## Security Considerations

1. **Keep your bot token secret**: Never commit it to version control
2. **Restrict bot access**: Only add authorized users to the admin group
3. **Monitor bot activity**: Regularly check bot logs for suspicious activity
4. **Use environment variables**: Always use `.env` file for configuration
5. **Limit permissions**: Give the bot only necessary permissions

## Advanced Configuration

### Custom Parse Mode

The default parse mode is Markdown. You can customize it in `src/service/telegramService.js`:

```javascript
export async function sendTelegramMessage(chatId, message, options = {}) {
  // ...
  const result = await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML', // or 'MarkdownV2'
    ...options
  });
  // ...
}
```

### Multiple Admin Chats

To send notifications to multiple chats, modify the service to accept comma-separated chat IDs:

```javascript
const adminChatIds = process.env.TELEGRAM_ADMIN_CHAT_ID?.split(',') || [];
```

### Disable Telegram (Testing)

For testing without Telegram:

```bash
TELEGRAM_SERVICE_SKIP_INIT=true npm test
```

## Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [BotFather Commands](https://core.telegram.org/bots#botfather)
- [Telegram Bot Examples](https://core.telegram.org/bots/samples)

## Support

For issues related to:
- Bot creation: Contact @BotFather on Telegram
- Integration issues: Check application logs
- API errors: Refer to Telegram Bot API documentation
