# User Login with WhatsApp Implementation

## Overview

This document describes the implementation of the new authentication mechanism for the `/api/auth/user-login` endpoint that allows users to login using their `user_id` and `whatsapp` number instead of requiring a password. This change enables Android APK users to easily access the system.

## Problem Statement

The original issue stated:
> "POST /api/auth/user-login 401 2.159 ms - 69 periksa pada endpoint tersebut dan ubah mekanisme nya agar user bisa melakukan login dengan menggunakan user id dan no whatsapp dan mengakses frontend android apk"

Translation: Check the endpoint and change the mechanism so users can login using user ID and WhatsApp number to access the Android APK frontend.

## Solution

### Implementation Details

The `/api/auth/user-login` endpoint now supports **two authentication methods**:

#### Method 1: User ID + WhatsApp (New)
```json
POST /api/auth/user-login
Content-Type: application/json

{
  "user_id": "123456",
  "whatsapp": "628123456789"
}
```

**Response (Success)**:
```json
{
  "success": true,
  "token": "<JWT_TOKEN>",
  "user": {
    "user_id": "123456",
    "nama": "User Name",
    "role": "user"
  }
}
```

**Response (Error - Invalid Credentials)**:
```json
{
  "success": false,
  "message": "Login gagal: user_id atau whatsapp tidak sesuai"
}
```

**Response (Error - Invalid WhatsApp)**:
```json
{
  "success": false,
  "message": "whatsapp tidak valid"
}
```

#### Method 2: NRP + Password (Legacy - Backward Compatible)
```json
POST /api/auth/user-login
Content-Type: application/json

{
  "nrp": "123456",
  "password": "SecurePass123!"
}
```

This method continues to work as before, maintaining backward compatibility.

### Validation Rules

1. **User ID + WhatsApp Method**:
   - Both `user_id` and `whatsapp` must be provided
   - WhatsApp number is normalized (non-digit characters removed)
   - WhatsApp number must be at least 8 digits long
   - User ID and WhatsApp must match a record in the database

2. **NRP + Password Method**:
   - Both `nrp` and `password` must be provided
   - Password must match the stored hash
   - User must have a password_hash set in the database

3. **Error Handling**:
   - If neither complete set of credentials is provided, returns 400
   - If credentials don't match, returns 401
   - If WhatsApp number is invalid, returns 400

### Code Changes

#### Modified Files

1. **src/routes/authRoutes.js**
   - Added logic to detect which authentication method is being used
   - Added WhatsApp number validation
   - Added database query for user_id + whatsapp authentication
   - Maintained all existing session management and logging

2. **tests/authRoutes.test.js**
   - Added 5 new test cases for the new authentication method
   - Updated 1 existing test case to match new error messages
   - All 9 user-login tests passing

3. **docs/login_api.md**
   - Documented both authentication methods
   - Added examples and usage notes
   - Explained when to use each method

### Testing

All tests are passing:
```
POST /user-login
  ✓ logs in user with correct password (password method)
  ✓ returns 401 when user has no password_hash
  ✓ returns 401 when password is incorrect
  ✓ returns 400 when nrp or password missing
  ✓ logs in user with user_id and whatsapp (new method)
  ✓ normalizes whatsapp number for user_id login
  ✓ returns 401 when user_id and whatsapp do not match
  ✓ returns 400 when whatsapp number is invalid
  ✓ returns 400 when neither credential set is provided
```

### Example Usage

#### Using curl

**New Method (user_id + whatsapp):**
```bash
curl -X POST http://localhost:3000/api/auth/user-login \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "123456", "whatsapp": "628123456789"}'
```

**Legacy Method (nrp + password):**
```bash
curl -X POST http://localhost:3000/api/auth/user-login \
  -H 'Content-Type: application/json' \
  -d '{"nrp": "123456", "password": "SecurePass123!"}'
```

#### Using JavaScript/Node.js

```javascript
// New method
const response = await fetch('http://localhost:3000/api/auth/user-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: '123456',
    whatsapp: '628123456789'
  })
});

const data = await response.json();
if (data.success) {
  const token = data.token;
  // Use token for subsequent requests
}
```

### Security Considerations

1. **Authentication Security**:
   - WhatsApp numbers must match exactly what's stored in the database
   - Error messages are generic to avoid information leakage
   - User IDs are normalized using existing utility functions

2. **Session Management**:
   - Same session management for both methods
   - Tokens stored in Redis with 2-hour expiration
   - Previous sessions cleared on new login

3. **Known Issues**:
   - **Rate Limiting**: CodeQL scan identified that this route (and all auth routes in this file) lack rate limiting. This is a pre-existing issue that should be addressed in a separate PR for all authentication endpoints.

### Migration Notes

For Android APK developers:
1. Update your login screen to collect `user_id` and `whatsapp` instead of password
2. Send these values to `/api/auth/user-login`
3. Store the returned token for subsequent API calls
4. Use the token in `Authorization: Bearer <token>` header

### Database Schema

The implementation assumes the `user` table has the following relevant columns:
- `user_id` (VARCHAR) - User identifier (NRP)
- `nama` (VARCHAR) - User full name
- `whatsapp` (VARCHAR) - WhatsApp number (normalized, digits only)
- `password_hash` (VARCHAR) - Hashed password (optional, for legacy auth)

### Future Improvements

1. Add rate limiting to prevent brute force attacks
2. Add audit logging for failed login attempts
3. Consider adding OTP verification for WhatsApp-based login
4. Add account lockout after multiple failed attempts

## Conclusion

This implementation successfully enables users to login using their user ID and WhatsApp number, making it easier for Android APK users to access the system while maintaining backward compatibility with the existing password-based authentication.
