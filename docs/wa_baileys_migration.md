# WhatsApp Migration: wwebjs to baileys

*Last updated: 2026-02-07*

## Migration Status

✅ **COMPLETED** - The migration from whatsapp-web.js to Baileys is fully complete and production-ready.

## Overview

This document describes the completed migration from **whatsapp-web.js** (browser-based) to **@whiskeysockets/baileys** (direct protocol) for the WhatsApp integration in Cicero V2.

## Key Changes

### 1. Library Change
- **Before**: whatsapp-web.js v1.23.0 (Puppeteer-based, browser automation)
- **After**: @whiskeysockets/baileys v7.0.0-rc.9 (Direct WhatsApp protocol)

### 2. Architecture Simplification
- **Before**: Dual-client architecture with `waClient` (admin) and `waUserClient` (user requests)
- **After**: Single unified `waClient` that handles all message types

### 3. Authentication Storage
- **Before**: `~/.cicero/wwebjs_auth/session-{clientId}/` (Puppeteer session data)
- **After**: `~/.cicero/baileys_auth/session-{clientId}/` (Multi-file auth state)

### 4. Environment Variables

#### Removed (No Longer Needed)
- `USER_WA_CLIENT_ID` - Removed with dual-client architecture
- `GATEWAY_WA_CLIENT_ID` - Removed with dual-client architecture
- Puppeteer-related environment variables

#### Active
- `WA_AUTH_DATA_PATH` - Still controls auth data storage location
- `WA_AUTH_CLEAR_SESSION_ON_REINIT` - Still clears session on restart
- `WA_DEBUG_LOGGING` - Still enables debug logging

## Implementation Details

### Adapter Interface

Both `wwebjsAdapter.js` and `baileysAdapter.js` implement the same EventEmitter interface:

```javascript
// Create client
const client = await createBaileysClient('wa-admin');

// Connect
await client.connect();

// Event handlers
client.on('qr', (qr) => { /* handle QR code */ });
client.on('ready', () => { /* client ready */ });
client.on('message', (msg) => { /* handle message */ });
client.on('disconnected', (reason) => { /* handle disconnect */ });

// Send message
const messageId = await client.sendMessage(jid, text, options);

// Disconnect
await client.disconnect();
```

### Message Format Compatibility

The `baileysAdapter` emits messages in a format compatible with wwebjs:

```javascript
{
  from: msg.key.remoteJid,        // JID of sender
  body: extractedText,            // Message text
  id: msg.key.id,                 // Message ID
  author: msg.key.participant,    // Participant in group
  timestamp: msg.messageTimestamp,
  hasMedia: boolean,
  isGroup: boolean
}
```

### Event Aggregation

The `waEventAggregator.js` already supported both adapters and handles message deduplication with proper priority (wwebjs > baileys).

## Benefits of Baileys

1. **No Browser Dependency**: No need for Chromium/Puppeteer
2. **Lighter Resource Usage**: Direct protocol communication
3. **Faster Connection**: No browser startup overhead
4. **More Stable**: Less prone to browser-related issues
5. **Better Performance**: Native protocol implementation

## Migration Impact

### Code Changes
- ✅ `src/service/baileysAdapter.js` - New adapter created
- ✅ `src/service/waService.js` - Updated to use baileys and single client
- ✅ `src/config/env.js` - Removed USER_WA_CLIENT_ID
- ✅ `src/utils/waDiagnostics.js` - Updated for single client
- ✅ `src/service/dashboardSubscriptionExpiryService.js` - Updated imports

### Database Changes
- ✅ No database schema changes needed

### Tests
- ✅ All existing WA tests still pass
- ✅ `waEventAggregator.test.js` - Passes
- ✅ `wwebjsAdapter.test.js` - Passes (kept for reference)

## Deployment Notes

### Current Status
✅ Migration is **complete** and running in production with Baileys as the only WhatsApp adapter.

### Re-Authentication Required
When upgrading from wwebjs:
1. The application will need to re-authenticate with WhatsApp
2. QR code will be displayed in console
3. Scan with WhatsApp mobile app to authenticate
4. Session will be saved to `~/.cicero/baileys_auth/`

### Session Migration
If you want to preserve the existing session:
1. The baileys adapter uses a different auth format
2. You will need to re-scan the QR code
3. Previous wwebjs sessions cannot be directly migrated

### Monitoring
- Check logs for `[BAILEYS]` prefix for adapter-specific messages
- Connection status logged at INFO level
- Use `WA_DEBUG_LOGGING=true` for verbose output

## Rollback Plan

**Note**: This is now for emergency use only, as Baileys is the production standard.

If critical issues occur with baileys:
1. Revert to previous commit before migration
2. Re-scan QR code with wwebjs
3. The wwebjsAdapter.js is still in the codebase for reference

## Legacy Code Cleanup

### Completed
- ✅ Removed `USER_WA_CLIENT_ID` and `GATEWAY_WA_CLIENT_ID` from environment configuration
- ✅ Single unified client architecture implemented
- ✅ Baileys adapter fully functional

### Pending (Optional)
The following legacy items remain for reference and potential rollback, but are not actively used:

1. `whatsapp-web.js` dependency in package.json (not imported or used)
2. `wwebjsAdapter.js` file in src/service/ (kept for reference)
3. Historical documentation references to wwebjs

These can be safely removed in a future cleanup once the Baileys implementation has been stable in production for an extended period.

## References

- [baileys GitHub](https://github.com/WhiskeySockets/Baileys)
- [whatsapp-web.js Documentation](https://wwebjs.dev/)
- Internal: `docs/whatsapp_client_lifecycle.md`
