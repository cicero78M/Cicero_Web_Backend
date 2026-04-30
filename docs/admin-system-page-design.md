# Desain Halaman Admin System (Khusus Telegram Admin)

## Tujuan
Menyediakan halaman admin terpisah dari login/dashboard existing untuk mengelola dana manajemen sistem secara global.

## URL Frontend yang disarankan
- `/admin-system/login` (halaman login OTP Telegram)
- `/admin-system` (dashboard overview)
- `/admin-system/funds` (modul dana manajemen)
- `/admin-system/analysis` (konfigurasi sistem + risk analysis)

## Mekanisme Akses
1. Admin buka `/admin-system/login` dan input `telegram_chat_id`.
2. Frontend panggil `POST /api/admin-system/auth/telegram/request`.
3. Backend kirim OTP 6 digit ke Telegram admin yang terdaftar di `TELEGRAM_ADMIN_CHAT_ID`.
4. Admin input OTP + `request_id`.
5. Frontend panggil `POST /api/admin-system/auth/telegram/verify`.
6. Backend keluarkan JWT role `system_admin` (valid 2 jam).
7. Frontend simpan token dan pakai `Authorization: Bearer <token>`.

## Endpoint yang tersedia
- `POST /api/admin-system/auth/telegram/request`
- `POST /api/admin-system/auth/telegram/verify`
- `GET /api/admin-system/management/overview` (protected)
- `GET /api/admin-system/management/funds` (protected)
- `GET /api/admin-system/management/funds/transactions` (protected)
- `POST /api/admin-system/management/funds/transactions` (finance_admin/super_admin)
- `GET /api/admin-system/management/funds/requests` (protected)
- `POST /api/admin-system/management/funds/requests` (finance_admin/super_admin)
- `POST /api/admin-system/management/funds/requests/:requestId/approve` (finance_admin/super_admin)
- `POST /api/admin-system/management/funds/requests/:requestId/reject` (finance_admin/super_admin)
- `GET /api/admin-system/management/funds/audit` (protected)
- `GET /api/admin-system/management/funds/audit/export.csv` (protected)
- `GET /api/admin-system/management/funds/summary?period=daily|weekly|monthly` (protected)
- `GET /api/admin-system/management/config` (protected)
- `GET /api/admin-system/management/config/audit` (protected)

## Komponen UI yang disarankan
### 1) Login OTP Telegram
- Input `telegram_chat_id`
- Input `request_id`
- Input `otp_code`
- CTA: "Kirim OTP" dan "Verifikasi"

### 2) Admin Overview
- Kartu metrik:
  - Total Client
  - Total Dashboard User
  - Pending Premium Request
- Aksi cepat:
  - Buka modul dana manajemen
  - Lihat audit/log (tahap berikutnya)

### 3) Funds Management
- Tab:
  - Alokasi Dana
  - Approval Pengajuan
  - Audit Perubahan Dana
- Fitur aktif:
  - Buat transaksi dana
  - Buat request dana
  - Approve/reject request + alasan
  - Filter + pagination data request/transaksi/audit
  - Export audit log ke CSV
- Summary dana harian/mingguan/bulanan

### 4) System Analysis
- Snapshot konfigurasi admin system (TTL, timezone, pagination, role mapping)
- Risk analysis (issues, warnings, risk level)
- Audit trail perubahan konfigurasi

## Catatan Keamanan
- Hanya chat ID yang ada di `TELEGRAM_ADMIN_CHAT_ID` yang bisa request OTP.
- OTP expired 5 menit, maksimal 3 kali salah.
- Token admin diverifikasi via Redis session (`login_token`) + JWT.
- Route admin dipisah total dari route dashboard biasa.
- Role granular via env `ADMIN_SYSTEM_ROLE_MAP` (JSON object):
  - `super_admin`
  - `finance_admin`
  - `auditor`

Contoh:
```env
ADMIN_SYSTEM_ROLE_MAP={"1836914805":"super_admin","123456789":"auditor"}
```

## Migrasi Database
Jalankan migrasi:
- `sql/migrations/20260430_create_system_management_funds.sql`
- `sql/migrations/20260430_create_system_management_config_audit.sql`

Tabel baru:
- `system_management_fund_transaction`
- `system_management_fund_request`
- `system_management_fund_audit`
- `system_management_config_audit`
