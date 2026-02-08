# Telegram Bot Integration Guide

*Last updated: 2026-02-08*

## Overview

Cicero V2 uses Telegram Bot API for admin notifications, approval mechanisms, and login event logging. This document describes how to set up and use the Telegram bot integration.

## Table of Contents

1. [Setup](#setup)
2. [Configuration](#configuration)
3. [Features](#features)
4. [Command Reference](#command-reference)
5. [Architecture](#architecture)
6. [Troubleshooting](#troubleshooting)

---

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow the prompts to:
   - Choose a name for your bot (e.g., "Cicero Admin Bot")
   - Choose a username for your bot (must end in "bot", e.g., "cicero_admin_bot")
4. Save the **bot token** provided by BotFather (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

There are several ways to get your Telegram chat ID:

**Method 1: Using getUpdates API**
1. Start a conversation with your bot
2. Send any message to the bot
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789}` in the JSON response
5. Save the chat ID

**Method 2: Using a Bot**
1. Search for `@userinfobot` in Telegram
2. Start the bot and it will show your chat ID

**Method 3: For Groups**
1. Add your bot to the group
2. Send a message to the group
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for the group chat ID (will be negative, e.g., -987654321)

### 3. Configure Environment Variables

Add these variables to your `.env` file:

```ini
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321,-123456789
```

**Notes:**
- `TELEGRAM_BOT_TOKEN` - Your bot token from BotFather (required)
- `TELEGRAM_ADMIN_CHAT_IDS` - Comma-separated list of chat IDs that should receive admin notifications
  - Individual chat IDs are positive numbers
  - Group chat IDs are negative numbers
  - Multiple admins can be configured

---

## Configuration

### Environment Variables

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot authentication token from BotFather | `123456789:ABCdef...` | Yes |
| `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated admin chat IDs | `123456789,987654321` | Yes |

### Testing Configuration

To verify your configuration is correct:

1. Start the application:
   ```bash
   npm start
   ```

2. Look for these log messages:
   ```
   [TELEGRAM] Initializing bot...
   [TELEGRAM] Bot connected: @your_bot_username (Bot Name)
   ```

3. Send `/help` command to your bot to see available commands

---

## Features

### 1. Dashboard User Approval

When a new user registers for dashboard access, admins receive a notification in Telegram:

```
📋 Permintaan User Approval

Username: john_doe
ID: du-12345
Role: operator
WhatsApp: 628123456789

Balas approvedash#john_doe untuk menyetujui
Atau denydash#john_doe untuk menolak.
```

### 2. Login Notifications

All login events are logged to admin Telegram chats:

**Penmas Login:**
```
🔑 Login Penmas

Username: admin_user
Role: admin
Waktu: 08/02/2026, 15:30:00
```

**Dashboard Login:**
```
🔑 Login Dashboard

Username: operator1
Role: operator
Client ID(s): DITBINMAS, POLDA_JATIM
Waktu: 08/02/2026, 15:30:00
```

**User Mobile Login:**
```
🔑 Login User

User ID: user-123
Username: John Doe
Waktu: 08/02/2026, 15:30:00
```

**Client Login:**
```
🔑 Login Client

Username: DITBINMAS Client
User ID: DITBINMAS
Role: operator_whatsapp
Waktu: 08/02/2026, 15:30:00
```

### 3. Failed Login Notifications

```
❌ Login gagal

Alasan: client_id tidak ditemukan
ID: INVALID_ID
Operator: 628123456789
Waktu: 08/02/2026, 15:30:00
```

### 4. Web Access Notifications

```
🔍 Web dibuka

IP: 192.168.1.100
UA: Mozilla/5.0...
Waktu: 08/02/2026, 15:30:00
```

### 5. Premium Subscription Requests

```
💎 Permintaan Premium Subscription

User: operator1
Client ID: DITBINMAS
Tier: premium_1

Balas grantdashsub#operator1 untuk menyetujui
Atau denydashsub#operator1 untuk menolak.
```

### 6. Approval/Rejection Confirmations

When an admin approves or rejects a user, a confirmation is sent:

```
✅ Dashboard User Approved

Username: john_doe
User ID: du-12345
WhatsApp: 628123456789
```

```
❌ Dashboard User Rejected

Username: john_doe
User ID: du-12345
WhatsApp: 628123456789
```

---

## Command Reference

All commands must be sent from a configured admin chat ID.

### Approval Commands

| Command | Description | Example |
|---------|-------------|---------|
| `approvedash#<username>` | Approve dashboard user registration | `approvedash#john_doe` |
| `denydash#<username>` | Deny dashboard user registration | `denydash#john_doe` |

### Subscription Commands

| Command | Description | Example |
|---------|-------------|---------|
| `grantdashsub#<username>` | Grant premium subscription | `grantdashsub#john_doe` |
| `denydashsub#<username>` | Deny premium subscription | `denydashsub#john_doe` |

### Help Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and available commands |
| `/help` | Show help message with command list |

### Command Responses

**Successful Approval:**
```
✅ User john_doe telah disetujui
```

**User Not Found:**
```
❌ User john_doe tidak ditemukan
```

**Error:**
```
❌ Error: <error message>
```

---

## Architecture

### Components

1. **telegramAdapter.js** - Low-level Telegram Bot API wrapper
   - Initializes bot connection
   - Handles polling for incoming messages
   - Provides `sendMessage()` method
   - Emits events: `ready`, `message`, `error`, `disconnected`

2. **telegramService.js** - High-level service layer
   - Manages message queue with PQueue (concurrency: 1)
   - Provides `notifyAdmin()` for broadcasting to all admins
   - Handles command processing (approvals, subscriptions)
   - Queues notifications when bot is not ready

3. **telegramHelper.js** - Formatting utilities
   - HTML escaping for Telegram's HTML mode
   - Message formatting functions (bold, italic, code)
   - Pre-formatted notification templates
   - Safe message sending with error handling

### Message Flow

```
Application Event
    ↓
telegramService.notifyAdmin()
    ↓
Message Queue (PQueue)
    ↓
telegramAdapter.sendMessage()
    ↓
Telegram Bot API
    ↓
Admin Chat(s)
```

### Command Processing Flow

```
User sends command in Telegram
    ↓
telegramAdapter receives message
    ↓
telegramAdapter emits 'message' event
    ↓
telegramService.handleIncomingMessage()
    ↓
Check if sender is admin
    ↓
Parse command
    ↓
Execute action (approve, deny, grant, etc.)
    ↓
Send confirmation back to admin
```

### Code Structure

```
src/
├── service/
│   ├── telegramAdapter.js       # Bot connection and API wrapper
│   └── telegramService.js       # Service layer with command handling
├── utils/
│   └── telegramHelper.js        # Formatting utilities
├── controller/
│   └── dashboardUserController.js  # Calls notifyAdmin() for approvals
└── routes/
    └── authRoutes.js            # Calls notifyAdmin() for login events
```

---

## Troubleshooting

### Bot Not Connecting

**Symptom:**
```
[TELEGRAM] Failed to initialize bot: getaddrinfo ENOTFOUND api.telegram.org
```

**Solution:**
- Check your internet connection
- Verify your bot token is correct
- Ensure Telegram API is not blocked by firewall

### No Notifications Received

**Symptom:** Bot connects but no notifications appear in Telegram

**Possible Causes:**
1. **Incorrect Chat ID**
   - Solution: Double-check your chat ID using `/getUpdates` API
   - Make sure you've sent at least one message to the bot first

2. **Not Configured as Admin**
   - Solution: Verify `TELEGRAM_ADMIN_CHAT_IDS` includes your chat ID

3. **Bot Polling Error**
   - Check console for `[TELEGRAM] Polling error` messages
   - Restart the application

### Commands Not Working

**Symptom:** Commands sent to bot have no effect

**Possible Causes:**
1. **Not an Admin Chat**
   - Commands only work from configured admin chat IDs
   - Check console: `[TELEGRAM] Ignoring message from non-admin chat: 123456`

2. **Incorrect Command Format**
   - Commands are case-sensitive
   - Use exact format: `approvedash#username` (no spaces)

3. **User Not Found**
   - Verify the username exists in the database
   - Check response message for details

### Testing Without Breaking Production

If you need to test Telegram integration without affecting production:

1. Create a separate test bot with BotFather
2. Get your personal chat ID
3. Configure test environment:
   ```ini
   TELEGRAM_BOT_TOKEN=<test_bot_token>
   TELEGRAM_ADMIN_CHAT_IDS=<your_personal_chat_id>
   ```
4. Run application in development mode

### Debugging

Enable detailed logging:

```javascript
// In telegramAdapter.js, the logging is based on WA_DEBUG_LOGGING
// To enable, set environment variable:
WA_DEBUG_LOGGING=true
```

Check application logs for:
- `[TELEGRAM]` prefix indicates Telegram-related logs
- Connection status
- Message sending attempts
- Error messages

### Rate Limiting

Telegram has rate limits:
- 30 messages per second to the same chat
- 20 messages per minute to different chats

The message queue (PQueue with concurrency: 1) automatically handles rate limiting by processing messages sequentially.

If you hit rate limits, you'll see:
```
[TELEGRAM] Failed to send message: 429 Too Many Requests
```

**Solution:** The built-in queue will retry automatically. If persistent, reduce notification frequency in application logic.

---

## Migration from WhatsApp

### Differences from WhatsApp Integration

| Feature | WhatsApp (Baileys) | Telegram |
|---------|-------------------|----------|
| Setup Complexity | High (QR code, session management) | Low (just bot token) |
| Authentication | Phone number required | Bot token |
| Message Format | Plain text only | HTML, Markdown, or plain text |
| Commands | Text-based parsing | Native command support |
| Session Management | File-based auth state | Stateless (token-based) |
| Reconnection | Manual QR scan may be needed | Automatic |
| Rate Limits | Variable, depends on phone number | Well-defined limits |

### Code Changes Required

When migrating from WhatsApp to Telegram:

1. **Import Changes:**
   ```javascript
   // Before (WhatsApp)
   import waClient, { waitForWaReady } from '../service/waService.js';
   import { safeSendMessage, formatToWhatsAppId } from '../utils/waHelper.js';
   
   // After (Telegram)
   import { notifyAdmin } from '../service/telegramService.js';
   import { formatSimpleNotification } from '../utils/telegramHelper.js';
   ```

2. **Notification Calls:**
   ```javascript
   // Before (WhatsApp)
   await waitForWaReady();
   for (const wa of getAdminWAIds()) {
     safeSendMessage(waClient, wa, message);
   }
   
   // After (Telegram)
   await notifyAdmin(message);
   ```

3. **Message Formatting:**
   ```javascript
   // Before (WhatsApp - plain text only)
   const message = `Login: ${username}\nWaktu: ${time}`;
   
   // After (Telegram - HTML formatting)
   const message = formatLoginNotification({
     type: 'dashboard',
     username,
     time
   });
   ```

### Backward Compatibility

WhatsApp integration code remains in the codebase for backward compatibility. If you need both:

```javascript
// Dual notification approach
import { notifyAdmin as notifyTelegram } from '../service/telegramService.js';
import { notifyAdmin as notifyWhatsApp } from '../service/waService.js';

// Send to both channels
await Promise.allSettled([
  notifyTelegram(message),
  notifyWhatsApp(message)
]);
```

---

## Security Considerations

1. **Bot Token Security**
   - Never commit `.env` file to version control
   - Rotate bot token if accidentally exposed
   - Use BotFather's `/revoke` command if token is compromised

2. **Admin Chat ID Verification**
   - Only configured chat IDs can execute commands
   - Log all command attempts with sender ID
   - Review admin chat IDs regularly

3. **Command Injection**
   - All user inputs are escaped in HTML mode
   - Username validation happens before processing commands
   - Database queries use parameterized statements

4. **Rate Limiting**
   - Built-in queue prevents overwhelming Telegram API
   - Application-level throttling for high-frequency events

5. **Error Handling**
   - Failed notifications are logged but don't crash the application
   - Sensitive data is not included in error messages sent to Telegram

---

## Best Practices

1. **Use Separate Bots for Different Environments**
   - Development bot for testing
   - Production bot for live system

2. **Configure Multiple Admins**
   - Add multiple chat IDs to ensure notifications reach someone
   - Use group chats for team notifications

3. **Monitor Bot Status**
   - Check logs regularly for `[TELEGRAM]` errors
   - Set up alerts for bot disconnection

4. **Format Messages Clearly**
   - Use consistent formatting across notification types
   - Include all relevant context in notifications
   - Keep messages concise but informative

5. **Test Commands Thoroughly**
   - Test all commands in development first
   - Verify database changes after command execution
   - Check for edge cases (non-existent users, etc.)

---

## Future Enhancements

Potential improvements for the Telegram integration:

1. **Interactive Buttons**
   - Replace text commands with inline keyboard buttons
   - Approve/deny with single click

2. **User Notifications**
   - Allow users to link their Telegram accounts
   - Send approval status directly to users

3. **Rich Notifications**
   - Include user profile information
   - Add statistics and metrics to notifications

4. **Webhook Mode**
   - Switch from polling to webhooks for better performance
   - Requires HTTPS endpoint

5. **Multi-Language Support**
   - Detect user language preference
   - Send notifications in appropriate language

6. **Command Autocomplete**
   - Register bot commands with BotFather
   - Enable command suggestions in Telegram

---

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review application logs with `[TELEGRAM]` prefix
3. Verify configuration in `.env` file
4. Contact repository maintainer

---

## Related Documentation

- [README.md](../README.md) - Main project documentation
- [.env.example](../.env.example) - Environment variable examples
- [WhatsApp Baileys Migration](wa_baileys_migration.md) - Migration from WhatsApp

---

*This documentation is part of the Cicero V2 project. Last updated: 2026-02-08*
