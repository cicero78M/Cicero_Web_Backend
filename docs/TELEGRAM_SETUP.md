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
   - Never commit the token or print it in application/deployment logs.

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
TELEGRAM_BOT_TOKEN=<token-from-botfather>
TELEGRAM_ADMIN_CHAT_ID=<authorized-chat-id>

# Set true only when polling is intentionally disabled
TELEGRAM_SERVICE_SKIP_INIT=false
```

**Important Notes:**

- `TELEGRAM_BOT_TOKEN`: The token you received from @BotFather
- `TELEGRAM_ADMIN_CHAT_ID`: Your personal chat ID or group chat ID. **For multiple admins, use comma-separated chat IDs** (e.g., `987654321,123456789,-987654321`)
- For group chats, include the negative sign (e.g., `-987654321`)
- All chat IDs in this list will have permission to approve/reject users via bot commands
- Treat `TELEGRAM_BOT_TOKEN` as a production secret. Do not paste it into tickets, commits, screenshots, or logs.

## Long-polling ownership

Telegram permits only one active long-polling consumer for a bot token. Run polling for a given `TELEGRAM_BOT_TOKEN` in exactly one process. Do not start a second PM2 instance, cluster worker, local process, or another server with the same token and polling enabled; Telegram will terminate the competing `getUpdates` request with a `409 Conflict`.

If multiple application processes must send notifications with the same token, designate exactly one process as the polling owner and set `TELEGRAM_SERVICE_SKIP_INIT=true` on every non-owner. A skipped process does not receive commands or callback queries.

## Step 4: Restart the Application

After adding the environment variables, restart your application:

```bash
npm start
```

For the PM2 application defined by this repository (`cicero_v2`), an ordinary restart can retain the process's previous environment. Apply changed shell or `.env` values by restarting with environment refresh:

```bash
pm2 restart cicero_v2 --update-env
```

Then inspect sanitized startup status without displaying the token:

```bash
pm2 logs cicero_v2
```

Check the logs for successful initialization:

```
[Telegram] Bot initialized successfully (interactive mode with polling)
[Telegram] Command handlers registered
[Telegram] Callback handlers registered
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

### 2. User Registration Requests (Interactive)

When a new user registers, you'll receive an interactive message with buttons:

```
📋 Permintaan Registrasi Dashboard

User ID: user-123
Username: newuser
WhatsApp: 628123456789
Role: operator

Menunggu persetujuan admin

Gunakan tombol di bawah atau ketik:
/approvedash newuser untuk menyetujui
/denydash newuser untuk menolak

[✅ Setujui] [❌ Tolak]
```

You can:

- **Click the buttons** to instantly approve or reject
- **Use commands**: `/approvedash newuser` or `/denydash newuser`

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

You should receive a Telegram notification for the registration request with interactive buttons.

### 3. Test Approval Commands

Send a message to your bot:

```
/approvedash newuser
```

Or:

```
/denydash newuser
```

You should receive a confirmation message. If `dashboard_user.telegram_chat_id` has been verified and populated by an admin/operator, the user also receives a direct Telegram notification; public dashboard registration does not accept this field.

### 4. Test Inline Buttons

1. Click on the "✅ Setujui" or "❌ Tolak" buttons in the registration notification
2. The bot will process the action and send a confirmation
3. The buttons will be removed from the message after processing
4. If `dashboard_user.telegram_chat_id` is still empty, approval/rejection succeeds and the admin confirmation states that no Telegram chat ID is registered for the user

## Bot Commands

The Telegram bot supports the following commands:

### `/start`

Shows welcome message and available commands. Only works for authorized admins.

### `/approvedash <username>`

Approve a pending dashboard user registration.

**Example:**

```
/approvedash john_doe
```

**Response:**

```
✅ User "john_doe" berhasil disetujui.
```

### `/denydash <username>`

Reject a pending dashboard user registration.

**Example:**

```
/denydash jane_smith
```

**Response:**

```
✅ User "jane_smith" berhasil ditolak.
```

## Authorization

Only users/groups with chat IDs listed in `TELEGRAM_ADMIN_CHAT_ID` can:

- Receive approval request notifications
- Execute approval/rejection commands
- Click inline buttons

Non-admin users will receive:

```
❌ Anda tidak memiliki akses ke sistem ini.
```

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

Startup logs distinguish these states without printing `TELEGRAM_BOT_TOKEN`:

- `[Telegram] Bot unavailable: TELEGRAM_BOT_TOKEN is not configured` — the process has no token. Configure it and, under PM2, run `pm2 restart cicero_v2 --update-env`.
- `[Telegram] Polling intentionally disabled: TELEGRAM_SERVICE_SKIP_INIT=true` — polling was explicitly disabled. This is expected only for a non-owner process or a deliberately disabled deployment.
- `[Telegram] Polling failed to start (Telegram code: ...): ...` — a token was available but polling could not start. Investigate the sanitized error and verify that no other process polls with this token.
- `[Telegram] 409 Conflict: this bot token is being used for polling by another process` — stop the duplicate poller and leave exactly one polling owner.

Never add the token to diagnostic commands or log messages. If configuration must be checked, verify only whether the variable is set, not its value.

### Commands Not Working

1. **Check authorization**: Ensure your chat ID is in `TELEGRAM_ADMIN_CHAT_ID`
   - Send `/start` to the bot to verify authorization
   - If you see "❌ Anda tidak memiliki akses", your chat ID is not configured
2. **Check command format**: Commands are case-sensitive
   - Use `/approvedash username` not `/approveDash` or `approvedash`
3. **Check polling**: The bot must be initialized with polling enabled
   - Look for `[Telegram] Bot initialized successfully (interactive mode with polling)` in logs
4. **Check for errors**: Look for error messages in logs:
   ```
   [Telegram] Error handling approve command: ...
   ```

### Inline Buttons Not Appearing

1. **Check bot initialization**: Buttons require interactive mode (polling enabled)
2. **Check message format**: Ensure `reply_markup` is properly set
3. **Old messages**: Buttons only appear on new messages after the update

### Buttons Not Responding

1. **Check callback handler**: Ensure `setupCallbackHandlers()` is called during initialization
2. **Check authorization**: Only admin chat IDs can use buttons
3. **Check logs**: Look for callback query errors:
   ```
   [Telegram] Failed to remove inline keyboard: ...
   ```

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
    ...options,
  });
  // ...
}
```

### Multiple Admin Chats

Multiple admin chat IDs are already supported via comma-separated values in the environment variable:

```bash
TELEGRAM_ADMIN_CHAT_ID=987654321,123456789,-987654321
```

Each chat ID in this list will:

- Receive approval request notifications
- Have permission to approve/reject users via commands or buttons

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
