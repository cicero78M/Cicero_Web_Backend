# Login API Guide

*Last updated: 2026-02-16*

This document explains how clients, regular users and dashboard operators authenticate with the backend. Available endpoints:
- `/api/auth/login` for client operators,
- `/api/auth/user-login` and `/api/auth/user-register` for regular users,
- `/api/auth/dashboard-register` and `/api/auth/dashboard-login` for the web dashboard,
- `/api/auth/dashboard-password-reset/request` and `/api/auth/dashboard-password-reset/confirm` for dashboard password recovery (aliases available at `/api/auth/password-reset/request`, `/api/auth/password-reset/confirm`, and the unauthenticated `/api/password-reset/request` plus `/api/password-reset/confirm`).

All return a JSON Web Token (JWT) that must be included in subsequent requests unless noted otherwise.


## Cookie & CORS Deployment Notes (Web Browser)

Untuk deployment web yang mengandalkan cookie token lintas origin:

- `CORS_ORIGIN` **wajib** diisi origin frontend spesifik (contoh `https://frontend.example.com`) dan jangan gunakan `*`.
- Frontend harus mengirim request dengan credentials (`fetch(..., { credentials: 'include' })` atau konfigurasi setara di axios).
- Respons login (`/api/auth/login`, `/api/auth/penmas-login`, `/api/auth/user-login`, `/api/auth/dashboard-login`) mengembalikan `Set-Cookie: token=...` dan browser hanya akan menyimpannya jika CORS + cookie attribute valid.

### Matriks Environment Auth/Cookie

| Environment | `CORS_ORIGIN` | `AUTH_COOKIE_SAME_SITE` | `AUTH_COOKIE_SECURE` | `AUTH_COOKIE_DOMAIN` | Catatan |
|---|---|---|---|---|---|
| Local dev (FE & BE localhost) | `http://localhost:5173` | `lax` | `false` | *(kosong)* | Cocok untuk FE/BE localhost tanpa HTTPS. |
| Staging (cross-subdomain HTTPS) | `https://staging-frontend.example.com` | `none` | `true` | `.example.com` | Wajib HTTPS jika `sameSite=none`. |
| Production (cross-subdomain HTTPS) | `https://frontend.example.com` | `none` | `true` | `.example.com` | Rekomendasi untuk FE/BE beda subdomain. |
| Production (same-site domain) | `https://app.example.com` | `lax` | `true` | `.example.com` atau *(kosong)* | Gunakan `lax` bila FE/BE masih same-site. |

### Verifikasi `Set-Cookie` pada Login

1. Jalankan login dari browser (DevTools → Network).
2. Pastikan response memiliki header `Set-Cookie`.
3. Pastikan request login memuat credentials (`include`).
4. Cek tab Application/Storage → Cookies, lalu pastikan cookie `token` tersimpan untuk domain backend/parent domain yang tepat.
5. Jika cookie tidak tersimpan, cek kombinasi `sameSite`, `secure`, domain cookie, dan origin CORS.

### Panduan `sameSite` & `secure`

- FE/BE beda domain atau beda subdomain umumnya perlu `AUTH_COOKIE_SAME_SITE=none` dan `AUTH_COOKIE_SECURE=true`.
- `sameSite=none` akan ditolak browser jika `secure=false`.
- Jika deployment HTTP non-HTTPS (khusus lokal), gunakan `sameSite=lax` dan `secure=false`.

## 1. Payload Format

### Client Login
`POST /api/auth/login`
```json
{
  "client_id": "demo_client",
  "client_operator": "628123456789"
}
```

### User Login
`POST /api/auth/user-login`

This endpoint supports two authentication methods:

**Method 1: User ID + WhatsApp (New - for Android APK)**
```json
{
  "user_id": "123456",
  "whatsapp": "628123456789"
}
```

**Method 2: NRP + Password (Legacy)**
```json
{
  "nrp": "123456",
  "password": "Abcd1234!"
}
```

> **Note:** 
> - The new `user_id` + `whatsapp` method allows users to login using their user ID and WhatsApp number, enabling access from the Android APK frontend.
> - The legacy `nrp` + `password` method is still supported for backward compatibility. These credentials are registered through the claim flow (`/api/claim/register`).
> - WhatsApp numbers are normalized by removing non-digit characters and must be at least 8 digits long.

### User Registration
`POST /api/auth/user-register`
```json
{
  "nrp": "123456",
  "nama": "Budi",
  "client_id": "demo_client",
  "whatsapp": "628123456789"
}
```

The `whatsapp` value is normalized and stored as digits only with the `62` prefix (minimum 8 digits, e.g. `628123456789`) and never stores the `@c.us` suffix.

### Dashboard Registration
`POST /api/auth/dashboard-register`
```json
{
  "username": "admin",
  "password": "secret",
  "whatsapp": "628123456789",
  "client_id": "demo_client",
  "role": "operator"
}
```

The `whatsapp` field should contain digits only; any non-numeric characters will be removed before storage and the number is normalized to a `62` prefix (minimum 8 digits). The `@c.us` suffix is not stored.

### Dashboard Login
`POST /api/auth/dashboard-login`
```json
{
  "username": "admin",
  "password": "secret"
}
```

Every new dashboard account is created with `status` set to `false` and an approval request containing the username, ID, role, WhatsApp number, and client ID is sent to the WhatsApp administrators. 

**New Admin Registration Feature**: Admins can now approve or reject dashboard users via WhatsApp using:
- `approvedash#<username>` to approve
- `denydash#<username>` to reject

If a non-admin tries to use these commands, they will receive a message with instructions to register as an admin. Admins can register their WhatsApp number by:

1. Accessing the registration endpoint: `POST /api/admin/register-whatsapp`
2. Scanning the QR code provided with their WhatsApp mobile app
3. After successful pairing, their number is automatically registered in the system

See [Admin WhatsApp Registration](#admin-whatsapp-registration) section below for more details.

Successful dashboard login responses now include premium metadata when available:

```json
{
  "success": true,
  "token": "<JWT>",
  "user": {
    "dashboard_user_id": "du-123",
    "role": "operator",
    "client_ids": ["CLIENT_A"],
    "premium_status": true,
    "premium_tier": "gold",
    "premium_expires_at": "2025-01-01T00:00:00.000Z"
  }
}
```

The same `client_ids` and `role` from the dashboard token gate both the User Directory and the Anev/Polres dashboards. Operators who manage multiple clients must pass an explicit `client_id` when hitting `/api/dashboard/anev`; the backend will then pull active users via the shared User Directory helper, applying the same `scope` (`org`/`direktorat`) logic and optional `regional_id` filter so every dashboard view reads from a single source of truth.

When operator hanya memiliki satu `client_id` bertipe direktorat, JWT `role` dan field `user.role` akan dinormalisasi ke `client_id` tersebut dalam lowercase (mis. `DITSAMAPTA` → `ditsamapta`) agar downstream handler menggunakan konteks direktorat yang tepat.

### Dashboard Password Reset Request
`POST /api/auth/dashboard-password-reset/request`
*(aliases: `/api/auth/password-reset/request`, `/api/password-reset/request` — the last one requires no token)*
```json
{
  "username": "admin",
  "contact": "08123456789"
}
```

The backend normalises the contact number to start with `62` and validates that it matches the stored WhatsApp number for the specified username. When valid, a reset token that expires after 15 minutes is created and the operator receives a WhatsApp message containing the reset instructions.

Successful response:
```json
{
  "success": true,
  "message": "Instruksi reset password telah dikirim melalui WhatsApp."
}
```

If WhatsApp delivery fails, administrators are alerted and the API responds with a message instructing the operator to contact the admin for manual assistance.

### Dashboard Password Reset Confirmation
`POST /api/auth/dashboard-password-reset/confirm`
*(aliases: `/api/auth/password-reset/confirm`, `/api/password-reset/confirm` — the last one requires no token)*
```json
{
  "token": "63e80f9a-3e63-4ad4-8a69-7c7f4d92721e",
  "password": "Newpass123",
  "confirmPassword": "Newpass123"
}
```

The backend checks that the token exists, has not expired, and has not been used. On success the dashboard password hash is replaced, the token is marked as used, and all existing dashboard login sessions in Redis are cleared so the operator must log in again.

Successful response:
```json
{
  "success": true,
  "message": "Password berhasil diperbarui. Silakan login kembali."
}
```

Example error (expired token or mismatched confirmation):
```json
{
  "success": false,
  "message": "token reset tidak valid atau sudah kedaluwarsa"
}
```

### Password Reset Aliasing via `/api/password-reset/*`
`POST /api/password-reset/request`

`POST /api/password-reset/confirm`

These endpoints forward to the same dashboard password reset handlers described above but live under a dedicated `/api/password-reset/*` path for routing aliases. The payloads and success responses are identical to the dashboard flows:

**Request payload**
```json
{
  "username": "admin",
  "contact": "08123456789"
}
```

**Request success response**
```json
{
  "success": true,
  "message": "Instruksi reset password telah dikirim melalui WhatsApp."
}
```

**Confirm payload**
```json
{
  "token": "63e80f9a-3e63-4ad4-8a69-7c7f4d92721e",
  "password": "Newpass123",
  "confirmPassword": "Newpass123"
}
```

**Confirm success response**
```json
{
  "success": true,
  "message": "Password berhasil diperbarui. Silakan login kembali."
}
```

## 2. Example `curl`

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"client_id":"demo_client","client_operator":"628123456789"}'
```

A successful response looks like:
```json
{
  "success": true,
  "token": "<JWT>",
  "client": { "client_id": "demo_client", "nama": "Demo", "role": "client" }
}
```
The token is also delivered as an HTTP-only cookie named `token`.

## 3. Token Flow

1. The client or user submits credentials to the appropriate endpoint.
2. The backend verifies the data and generates a JWT valid for two hours.
3. The token is stored in Redis and returned in the response as well as the cookie.
4. For later API calls, include the token in the `Authorization: Bearer` header or let the cookie be sent automatically. Jika keduanya ada, backend memprioritaskan token dari header agar cookie lama tidak menimpa sesi terbaru.
5. Every successful login event is reported to the WhatsApp administrators.
6. Middleware auth memberi toleransi kecil terhadap drift waktu JWT (`JWT_CLOCK_TOLERANCE_SECONDS`, default `30` detik) dan grace period untuk token yang baru saja expired (`JWT_EXPIRED_GRACE_SECONDS`, default `86400` detik). Setelah melewati grace period atau token tidak ada di Redis, login ulang wajib dilakukan.
7. Dashboard password resets invalidate existing dashboard login sessions before returning a success response.
8. Each authenticated dashboard request reloads the dashboard user profile from the database to refresh `client_ids` (and derive `client_id` when only one is available). Requests are rejected when the dashboard user is missing, inactive, or no longer mapped to any clients so the scope always mirrors `dashboard_user_clients`.

### Dashboard session refresh

The `verifyDashboardToken` middleware revalidates dashboard JWTs against Redis and the `dashboard_user` table on every request. It rebuilds `req.dashboardUser`/`req.user` from the latest row, ensuring:
- Deactivated or deleted dashboard accounts cannot reuse old tokens.
- `client_ids` always match the current `dashboard_user_clients` mapping.
- When exactly one client is allowed, `client_id` is derived from the refreshed list; otherwise the field is omitted to prevent stale single-client scopes.

Jika dashboard login atau request mengembalikan `403` dengan pesan **Operator belum memiliki klien yang diizinkan**, pastikan relasi `dashboard_user_clients` sudah terisi. Gunakan script berikut untuk memeriksa dan menambahkan `client_ids` yang sesuai (mis. `JOMBANG`) ke akun dashboard yang sedang login:

```bash
node scripts/updateDashboardUserClients.js --username <username> --client-ids JOMBANG
```

Script ini akan:
- Memuat data dashboard user berdasarkan `--dashboard-user-id`, `--username`, atau `--whatsapp`.
- Memverifikasi `client_id` di tabel `clients`.
- Menambahkan relasi baru ke `dashboard_user_clients` dan menampilkan daftar terbaru `client_ids`.


### Client integration for protected endpoints

Untuk endpoint protected seperti `/api/link-reports`, `/api/link-reports-khusus`, dan `/api/users/:id`, client harus menyimpan token dari `POST /api/auth/user-login` lalu mengirimkannya di setiap request melalui header `Authorization: Bearer <token>`.

Khusus `POST /api/link-reports-khusus`:
- Untuk token mobile role `user`, `client_id` **tidak wajib** dikirim manual di body/query karena backend akan resolve dari profil user (`req.user.user_id` -> tabel `"user"`).
- Jika client tetap mengirim `client_id`, nilainya harus sama dengan profil user; jika tidak sama, backend mengembalikan `403 client_id tidak sesuai dengan profil user`.
- Untuk role dashboard/operator, guard multi-client tetap berlaku: `client_id` hasil resolusi harus termasuk dalam `client_ids` token.
- `instagram_link` tidak wajib; jika tidak dikirim maka payload harus menyertakan `shortcode` yang valid.

Jika header `Authorization` dikirim tetapi tidak menggunakan format `Bearer <token>`, backend akan merespons `401` dengan pesan `Authorization harus format Bearer token` untuk memudahkan diagnosis integrasi. Jika header/cookie token tidak ada sama sekali, respons tetap `401 Token required`.


Respons error dari middleware auth sekarang menyertakan field `reason` agar troubleshooting produksi lebih cepat tanpa mengekspos token sensitif. Field ini juga dicatat sebagai structured log server-side bersama metadata request aman (`method`, `path`, `sourceIp`, `userAgent` ringkas).

#### Auth error matrix (`authRequired`)

| HTTP Status | Message | Reason code | Kapan terjadi |
| --- | --- | --- | --- |
| `401` | `Token required` | `missing_token` | Header `Authorization` dan cookie `token` tidak ada. |
| `401` | `Authorization harus format Bearer token` | `invalid_token` | Header `Authorization` ada tetapi tidak diawali `Bearer `. |
| `401` | `Invalid token` | `invalid_token` | JWT tidak valid (signature salah, malformed, dsb.). |
| `401` | `Token expired` | `expired_token` | JWT valid namun sudah melewati waktu kedaluwarsa **dan** melampaui grace period `JWT_EXPIRED_GRACE_SECONDS`. |
| `403` | `Forbidden` | `forbidden_operator_path` | Role `operator` mengakses path di luar allowlist middleware. |

Konfigurasi tambahan untuk mengurangi false negative karena drift jam server/client:
- `JWT_CLOCK_TOLERANCE_SECONDS` (default `30`): toleransi validasi `exp/nbf` token pada proses `jwt.verify`.
- `JWT_EXPIRED_GRACE_SECONDS` (default `86400`): token yang baru expired masih diterima sementara waktu selama belum melewati grace.

Contoh respons:

```json
{
  "success": false,
  "message": "Token required",
  "reason": "missing_token"
}
```


Repository ini menyediakan helper `createProtectedApiClient` di `src/service/protectedApiClient.js` sebagai acuan integrasi client:

```js
import { createProtectedApiClient } from './src/service/protectedApiClient.js';

const apiClient = createProtectedApiClient({
  baseURL: 'http://localhost:3000',
  logger: console
});

await apiClient.userLogin({ nrp: '123456', password: 'Abcd1234!' });
await apiClient.getUserById('123456');
await apiClient.createLinkReport({ shortcode: 'abc123' });
await apiClient.createLinkReportKhusus({ shortcode: 'xyz789' });
```

Catatan penting:
- Helper mengaktifkan `withCredentials: true` untuk mendukung flow berbasis cookie.
- Request interceptor menambahkan `Authorization` otomatis ketika token tersedia.
- Sebelum request dikirim, helper melakukan logging `authorizationAttached` agar integrasi client mudah diverifikasi saat debugging.

## 4. Operator Access Allowlist

Role `operator` hanya diperbolehkan mengakses endpoint tertentu di bawah `/api`. Permintaan ke endpoint lain akan tetap diblokir dengan status `403` untuk menjaga keamanan.

Allowlist saat ini:
- `/api/clients/profile`
- `/api/aggregator` (termasuk sub-path seperti `/api/aggregator/refresh`)
- `/api/amplify/rekap`
- `/api/dashboard/stats`
- `/api/dashboard/login-web/recap`
- `/api/dashboard/social-media/instagram/analysis`

Jika operator membutuhkan endpoint lain, pastikan endpoint tersebut ditambahkan ke allowlist agar tidak terblokir.

Untuk endpoint yang menerima parameter `client_id` (terutama `/api/clients/profile` dan `/api/aggregator`), role **operator** hanya boleh menggunakan `client_id` yang ada di daftar `client_ids` pada token (pemeriksaan case-insensitive). Permintaan di luar daftar akan ditolak dengan status `403`.

`/api/clients/profile` sekarang menerima parameter `role`, `scope`, dan `regional_id` untuk memastikan profil yang diambil sesuai dengan konteks akses. Jika salah satu parameter tersebut dikirim, backend akan:
- Mewajibkan `role` dan memvalidasi `scope` (`org` atau `direktorat`).
- Menolak role direktorat yang tidak dikenal untuk `scope=direktorat`.
- Memastikan `regional_id` (dari query atau token) cocok dengan `regional_id` client yang dikembalikan.

Respons profil menyertakan alias tier untuk kebutuhan AuthContext front-end:
- `level` – alias dari `client_level` untuk menjaga kompatibilitas.
- `tier` – label tier yang dinormalisasi lowercase dari `client_level` atau snapshot premium.
- `premium_tier` – sinonim `tier` agar downstream yang memakai kolom premium tetap berjalan.

Contoh ringkas:
```json
{
  "success": true,
  "client": {
    "client_id": "LEVEL1",
    "client_level": "Premium_1",
    "level": "Premium_1",
    "tier": "premium_1",
    "premium_tier": "premium_1"
  }
}
```

Dokumentasi lengkap untuk `/api/amplify/rekap` (termasuk parameter `client_id`, `periode`, `tanggal`, `start_date`/`end_date`, `role`, `scope`, dan `regional_id`) tersedia di `docs/amplifyRekapApi.md`.

## 5. Dashboard Stats (`/api/dashboard/stats`)

Endpoint ini sekarang mengikuti aturan `role`/`scope`/`regional_id` yang sama dengan endpoint rekap Instagram/TikTok, sehingga jumlah post menyesuaikan konteks akses pengguna. **Hitungan TikTok memakai filter `scope`/`role`/`regional_id` yang sama dengan recap komentar TikTok**, sehingga dashboard tidak menampilkan jumlah yang lebih luas dibandingkan narasi recap. Jumlah `users` mengikuti filter yang sama; khusus `scope=org` dengan `role=operator`, backend hanya menghitung user ber-role operator pada `client_id` efektif. Parameter query yang tersedia:
- `client_id` (wajib jika token tidak berisi `client_id`; diabaikan ketika scope/role memaksa konteks tertentu)
- `periode` (`harian` default)
- `tanggal`
- `start_date`/`tanggal_mulai`
- `end_date`/`tanggal_selesai`
- `role` (opsional; default dari token, **wajib** jika `scope` dikirim)
- `scope` (`org` atau `direktorat`—default `org` bila dikirim tanpa nilai)
- `regional_id` (opsional; default dari token, disamakan ke huruf besar)

Resolusi konteks:
- Jika `scope`/`role` dikirim, backend akan mewajibkan `role` dan memvalidasi `scope` (`org`/`direktorat`).
- `scope=org` dengan `role=operator` selalu memakai `client_id` dari token (bukan dari query/header). Untuk `igPosts`, penghitungan **selalu** dikunci ke `client_id` token tersebut meski ada penyesuaian konteks direktorat lainnya.
- `scope=org` dengan role direktorat (`ditbinmas`, `ditlantas`, `bidhumas`, `ditsamapta`) menghitung post berdasarkan role tersebut sebagai `client_id` efektif.
- Khusus `ttPosts`, saat `scope=org` backend **default** memakai filter `client_id` efektif (tidak otomatis memakai role filter), sehingga perilaku sama dengan rekap komentar TikTok untuk konteks ORG.
- Untuk `ttPosts`, mode union `client_id OR tiktok_post_roles.role_name` hanya dipakai saat `scope=direktorat` (atau fallback legacy ketika `scope` tidak dikirim tetapi `client_id` yang dihitung bertipe direktorat). Role `operator` tidak pernah mengaktifkan filter role pada hitungan TikTok.
- `scope=direktorat` memakai `role` dan `regional_id` sebagai filter tambahan pada data post.
- Jika `role`/`scope` tidak dikirim, perilaku lama dipertahankan (mis. fallback `client_id=ditbinmas` bila token ber-role `ditbinmas`), tetapi perhitungan post tetap membawa `regional_id` dari token jika ada.
- Untuk hitungan Instagram, `scope=direktorat` akan memakai `role` sebagai filter `insta_post_roles` terlebih dahulu. Jika hasilnya kosong dan `client_id` yang diminta adalah client bertipe direktorat, backend otomatis fallback ke filter `client_id` langsung (mirroring TikTok). Parameter `regional_id` membatasi hitungan hanya pada klien dengan `regional_id` yang cocok sehingga dashboard bisa meminta agregasi per-wilayah tanpa mencampur regional lain.
- Cache post count memakai Redis dengan TTL default 60 detik. Jika payload memuat `tanggal`, TTL cache dipersingkat (10 detik) untuk menjaga data lebih segar; khusus endpoint dashboard stats, permintaan dengan `tanggal` menonaktifkan cache agar konsisten dengan rekap likes real-time.

Contoh response:
```json
{
  "success": true,
  "data": {
    "client_id": "DITBINMAS",
    "role": "ditbinmas",
    "scope": "org",
    "regional_id": "JATIM",
    "clients": 12,
    "users": 150,
    "igPosts": 5,
    "ttPosts": 7
  }
}
```

## 6. Dashboard Anev (`/api/dashboard/anev`)

Endpoint ini berada di belakang middleware `verifyDashboardToken`, sehingga wajib mengirim bearer token dashboard (`Authorization: Bearer <token>`). Middleware `dashboardPremiumGuard` mengecek snapshot premium dan:
- Mengembalikan **403** jika langganan premium tidak aktif atau sudah kedaluwarsa (ikut menyertakan `premium_tier` dan `premium_expires_at` bila ada).
- Mengembalikan **403** jika tier tidak ada di daftar diizinkan. Daftar ini dibaca dari `DASHBOARD_PREMIUM_ALLOWED_TIERS` (default: `tier1,tier2,premium_1`).
- Meneruskan permintaan hanya ketika token valid, premium aktif, dan tier sesuai.

Parameter query:
- `client_id` (wajib jika token tidak membawa `client_id`; harus termasuk dalam `dashboard_user.client_ids`). Dapat dikirim sebagai query atau header `X-Client-Id`.
- `role` dan `scope` (default dari token; `scope` hanya menerima `org` atau `direktorat`; `role` **wajib** dan ditolak 400 bila kosong)
- `regional_id` (opsional; di-normalisasi ke huruf besar)
- `time_range` (`today`, `7d` *(default)*, `30d`, `90d`, `custom`, `all`)
- `start_date` dan `end_date` (wajib bila `time_range=custom`; format tanggal mengikuti zona waktu Asia/Jakarta)

Validasi penting:
- `client_id` harus cocok dengan daftar izin user dashboard; jika dikirim tetapi tidak cocok, backend membalas **403** `client_id tidak diizinkan`.
- `scope` selain `org`/`direktorat` dibalas **400** `scope tidak valid`.
- `role` kosong dibalas **400** `role wajib diisi`.

Respons merangkum metadata filter dan agregat engagement:
- `user_directory` menyalin daftar user aktif dari helper User Directory agar frontend tidak perlu menggabungkan data lain.
- `instagram_engagement` dan `tiktok_engagement` masing-masing memuat total post, total likes/komentar, serta `per_user` yang sudah memetakan username ke `user_id` (username tak terpetakan tetap muncul dengan `unmapped=true`).
- Insight TikTok (`tiktok_engagement` dan `aggregates.tiktok_posts`) memakai basis tanggal `COALESCE(original_created_at, created_at)` dari tabel `tiktok_post`, lalu dikonversi konsisten dari UTC ke Asia/Jakarta sebelum diterapkan filter `start_date`/`end_date`, sehingga selaras dengan perhitungan post count TikTok.
- `filters.permitted_time_ranges` menegaskan daftar rentang waktu yang diterima.
- `filters.start_date`/`end_date` sudah dihitung ke batas awal/akhir hari Asia/Jakarta.
- `aggregates.total_users` menghitung user aktif (`status=true`) pada client/regional yang sesuai.
- `aggregates.total_likes` dan `aggregates.total_comments` dijumlahkan dari tabel likes/komentar dengan filter `client_id`, `role`/`scope`, dan `regional_id`.
- `aggregates.instagram_posts` dan `aggregates.tiktok_posts` ikut memakai filter `role` (bila dikirim) serta `scope`/`regional_id` yang sama sehingga seluruh agregat berada pada ruang filter identik.
- `aggregates.compliance_per_pelaksana` menampilkan likes, komentar, total aksi, serta `completion_rate` per pelaksana terhadap total konten dalam rentang yang sama.

Contoh request:
```bash
curl -X GET "https://api.example.com/api/dashboard/anev?time_range=90d&role=ditbinmas&scope=org" \
  -H "Authorization: Bearer <dashboard-jwt>" \
  -H "X-Client-Id: DITBINMAS"
```

Contoh response ringkas:
```json
{
  "success": true,
  "data": {
    "user_directory": [
      {
        "user_id": "u-1",
        "nama": "USER SATKER",
        "divisi": "SUBBID PENMAS",
        "client_id": "DITBINMAS",
        "kontak_sosial": {
          "instagram": "user_ig",
          "tiktok": "user_tt"
        }
      }
    ],
    "instagram_engagement": {
      "total_posts": 12,
      "total_likes": 320,
      "per_user": [
        {
          "user_id": "u-1",
          "nama": "USER SATKER",
          "divisi": "SUBBID PENMAS",
          "client_id": "DITBINMAS",
          "username": "user_ig",
          "kontak_sosial": {
            "instagram": "user_ig",
            "tiktok": "user_tt"
          },
          "likes": 10
        }
      ]
    },
    "tiktok_engagement": {
      "total_posts": 8,
      "total_comments": 110,
      "per_user": [
        {
          "user_id": "u-1",
          "nama": "USER SATKER",
          "divisi": "SUBBID PENMAS",
          "client_id": "DITBINMAS",
          "username": "user_tt",
          "kontak_sosial": {
            "instagram": "user_ig",
            "tiktok": "user_tt"
          },
          "comments": 4
        }
      ]
    },
    "filters": {
      "client_id": "DITBINMAS",
      "role": "ditbinmas",
      "scope": "org",
      "regional_id": "JATIM",
      "time_range": "7d",
      "start_date": "2025-02-01T00:00:00+07:00",
      "end_date": "2025-02-07T23:59:59.999+07:00",
      "permitted_time_ranges": ["today", "7d", "30d", "90d", "custom", "all"]
    },
    "aggregates": {
      "total_users": 45,
      "instagram_posts": 12,
      "tiktok_posts": 8,
      "total_likes": 320,
      "total_comments": 110,
      "expected_actions": 20,
      "compliance_per_pelaksana": [
        {
          "user_id": "u-1",
          "nama": "USER SATKER",
          "likes": 10,
          "comments": 4,
          "total_actions": 14,
          "completion_rate": 0.7
        }
      ]
    }
  }
}
```


## 7. Admin WhatsApp Registration

*Last updated: 2026-02-09*

### Overview

Admins can now approve or reject dashboard user registrations directly via WhatsApp using the commands:
- `approvedash#<username>` - Approve a dashboard user
- `denydash#<username>` - Reject a dashboard user

Only registered admin WhatsApp numbers can execute these commands. If a non-admin tries to use these commands, they will receive instructions on how to register.

### Admin Registration Process

Admin WhatsApp numbers can be registered in two ways:

1. **Environment Variable** (existing method): Add numbers to `ADMIN_WHATSAPP` in `.env`
   ```
   ADMIN_WHATSAPP=628123456789,628987654321
   ```

2. **Dynamic Registration** (new method): Register via QR code pairing using Baileys

### Dynamic Registration via QR Code

**Endpoint**: `POST /api/admin/register-whatsapp`

**Request Body** (optional):
```json
{
  "registered_by": "admin_username",
  "notes": "Optional registration notes"
}
```

**Response** (QR code generated):
```json
{
  "success": true,
  "sessionId": "admin-reg-1234567890-abc123",
  "qr": "2@BASE64_ENCODED_QR_DATA...",
  "status": "awaiting_scan",
  "message": "Scan QR code dengan WhatsApp Anda untuk mendaftar sebagai admin"
}
```

**Process**:
1. Call the registration endpoint
2. Display or convert the QR code on frontend (QR data is provided as base64 string)
3. Scan the QR code with WhatsApp mobile app
4. After successful pairing, the phone number is automatically extracted and registered
5. User receives a confirmation message via WhatsApp

**Check Registration Status**: `GET /api/admin/register-whatsapp/:sessionId/status`

Response when completed:
```json
{
  "success": true,
  "status": "registered",
  "phoneNumber": "628123456789",
  "createdAt": 1707467890000
}
```

### Other Admin Endpoints

**Check if WhatsApp number is admin**: `GET /api/admin/check-admin?whatsapp=628123456789`

Response:
```json
{
  "success": true,
  "isAdmin": true,
  "source": "database"
}
```

**List all admin WhatsApp numbers** (requires admin dashboard auth): `GET /api/admin/whatsapp`

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "whatsapp": "628123456789",
      "registered_at": "2026-02-09T05:15:00.000Z",
      "registered_by": "admin_username",
      "is_active": true,
      "notes": "Primary admin"
    }
  ]
}
```

**Deactivate an admin** (requires admin dashboard auth): `DELETE /api/admin/whatsapp/:whatsapp`

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "whatsapp": "628123456789",
    "is_active": false
  }
}
```

### WhatsApp Command Responses

When an admin executes `approvedash#username`:
- ✅ Success: "User 'username' berhasil disetujui."
- ❌ User not found: "User dengan username 'username' tidak ditemukan."
- ✅ Already approved: "User 'username' sudah disetujui sebelumnya."

When a non-admin tries to use the command:
```
❌ Anda tidak memiliki akses ke sistem ini.
```

### Database Schema

Admin WhatsApp numbers are stored in the `admin_whatsapp` table:

```sql
CREATE TABLE admin_whatsapp (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) NOT NULL UNIQUE,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registered_by VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT
);
```

### Security Notes

- Admin registration endpoints do not require authentication (to allow initial admin setup)
- Admin list and deactivation endpoints require dashboard admin authentication
- WhatsApp numbers are stored without the `@c.us` suffix (digits only)
- Both environment variable and database admins have equal privileges
- Deactivated admins can be reactivated by calling the registration endpoint again
