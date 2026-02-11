# Telegram Message Entity Parsing Bug Fix

## Problem
The application was experiencing errors when sending Telegram messages:
```
[Telegram] Failed to send message to 1836914805: ETELEGRAM: 400 Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 41
```

This error occurs when Telegram messages contain Markdown special characters in dynamic content that aren't properly escaped.

## Root Cause
The Telegram bot was sending messages with `parse_mode: 'Markdown'` enabled, but dynamic user data (usernames, names, account numbers, etc.) contained special Markdown characters that weren't escaped. When Telegram tried to parse these as Markdown entities, it encountered malformed syntax.

Special characters that cause issues in Telegram Markdown:
- `_` (underscore) - used for italic
- `*` (asterisk) - used for bold
- `[` `]` - used for links
- `(` `)` - used for link URLs
- `` ` `` (backtick) - used for inline code
- `~` - used for strikethrough
- `>` - used for blockquotes
- `#` `+` `-` `=` `|` `{` `}` `.` `!` - various Markdown syntax

## Solution

### 1. Added `escapeMarkdown()` Utility Function
Created a helper function to escape all Telegram Markdown special characters:

```javascript
function escapeMarkdown(text) {
  if (!text) return '';
  const str = String(text);
  return str
    .replace(/\\/g, '\\\\')  // Backslash must be escaped first
    .replace(/_/g, '\\_')     // Underscore
    .replace(/\*/g, '\\*')    // Asterisk
    // ... (escapes all special characters)
}
```

### 2. Implemented Automatic Retry Logic
Updated `sendTelegramMessage()` to catch parse entity errors and automatically retry without Markdown formatting:

```javascript
try {
  const result = await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    ...options
  });
  return result;
} catch (error) {
  // If parse error, retry without Markdown formatting
  if (error.message && error.message.includes("can't parse entities")) {
    console.warn(`[Telegram] Retrying message to ${chatId} without Markdown formatting`);
    const { parse_mode, ...optionsWithoutParseMode } = options;
    const result = await bot.sendMessage(chatId, message, optionsWithoutParseMode);
    return result;
  }
  return null;
}
```

### 3. Applied Escaping to All Notification Functions
Updated all functions that construct messages with dynamic data:
- `sendLoginLogNotification()` - escapes username, role, login type, source, timestamps
- `sendUserApprovalRequest()` - escapes user ID, username, WhatsApp, email, role
- `sendUserApprovalConfirmation()` - escapes username
- `sendUserRejectionConfirmation()` - escapes username
- `sendPremiumRequestNotification()` - escapes all user and payment data
- `sendDashboardPremiumRequestNotification()` - escapes all user, payment, and request data
- `sendPasswordResetToken()` - escapes username and base URL (but not token in backticks)
- `processApproval()` and `processRejection()` - escapes usernames in error messages
- `buildConfirmationMessage()` - escapes error messages

## Testing

### Unit Tests Added
1. **Retry logic test** - Verifies that when a parse error occurs, the function retries without Markdown
2. **Retry failure test** - Verifies that if both attempts fail, null is returned
3. **Escaping test** - Verifies that special characters in notifications are properly escaped

All 22 tests pass successfully.

### Manual Testing Recommendations
1. Test with usernames containing special characters (e.g., `user_name-2024`, `test(user)`)
2. Test with payment data containing parentheses or special symbols
3. Test error scenarios to ensure graceful fallback to plain text

## Impact

### Benefits
✅ Messages with special characters will now send successfully
✅ Automatic fallback ensures message delivery even if escaping fails
✅ No breaking changes - all existing functionality preserved
✅ Better error handling and logging

### Performance
- Minimal performance impact
- Retry only occurs on parse errors (rare)
- Escaping function is lightweight

## Security Analysis
✅ CodeQL scan completed: 0 vulnerabilities found
✅ No security issues introduced
✅ All dynamic content is properly sanitized

## Files Modified
1. `src/service/telegramService.js` - Added escaping function, retry logic, and applied to all notification functions
2. `tests/telegramService.test.js` - Added tests for retry logic and escaping

## Deployment Notes
- No configuration changes required
- No database migrations needed
- Backward compatible with existing code
- Safe to deploy to production immediately

## Monitoring
After deployment, monitor for:
- Decreased error logs for "can't parse entities"
- Any new logs showing retry attempts
- Successful message delivery rate

## References
- Telegram Bot API Documentation: https://core.telegram.org/bots/api#markdown-style
- Issue: "can't parse entities: Can't find end of the entity starting at byte offset 41"
