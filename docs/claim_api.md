# Claim API

Dokumen ini merangkum endpoint claim data berbasis NRP dan password (tanpa OTP email dan tanpa username).

## Registrasi Kredensial Claim
- **Endpoint:** `POST /api/claim/register`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Tujuan:** Menghubungkan user ke NRP yang sudah ada di tabel `user`, lalu menyimpan `password_hash` untuk login berbasis NRP.
- **Aturan validasi:**
  - `nrp` dan `password` wajib diisi.
  - `password` minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.

## Ambil Data Pengguna
- **Endpoint:** `POST /api/claim/user-data`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Catatan:** Endpoint menolak jika kombinasi NRP dan password tidak valid.

## Perbarui Data Pengguna
- **Endpoint:** `PUT /api/claim/update`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!", ... }`
- **Field yang didukung untuk update:**
  - Profil umum: `nama`, `title`, `divisi`, `jabatan`, `desa`
  - Kontak: `whatsapp`, `email`
  - Sosial: `insta`, `tiktok`
- **Aturan validasi tambahan:**
  - `whatsapp` dinormalisasi menjadi **digits-only** (semua karakter non-angka dihapus) dengan panjang minimal 8 digit.
  - `email` akan dinormalisasi ke lowercase dan harus sesuai format email.
  - `insta` dan `tiktok` menerima username atau URL profil, lalu dinormalisasi ke username.
  - Contoh normalisasi WhatsApp terbaru:
    - `0812-3456-7890` → `081234567890`
    - `+62 812 3456 7890` → `6281234567890`
    - `62.812.34` → **ditolak** (kurang dari 8 digit setelah normalisasi)
- **Format response error validasi (konsisten):**
  ```json
  {
    "success": false,
    "error_code": "CLAIM_INVALID_EMAIL_FORMAT",
    "field": "email",
    "message": "Format email tidak valid."
  }
  ```

### Daftar `error_code` Validasi Claim Update
| `error_code` | `field` | Kapan muncul |
|---|---|---|
| `CLAIM_INVALID_WHATSAPP_FORMAT` | `whatsapp` | Nomor WhatsApp tidak valid / digit kurang dari batas minimum. |
| `CLAIM_INVALID_EMAIL_FORMAT` | `email` | Format email tidak valid. |
| `CLAIM_INVALID_INSTAGRAM_FORMAT` | `insta`, `instagram_accounts` | Format username/link Instagram tidak valid. |
| `CLAIM_INVALID_TIKTOK_FORMAT` | `tiktok`, `tiktok_accounts` | Format username/link TikTok tidak valid. |
| `CLAIM_USERNAME_BLOCKED` | `insta`, `tiktok`, `instagram_accounts`, `tiktok_accounts` | Username `cicero_devs` tidak diperbolehkan. |
| `CLAIM_DUPLICATE_USERNAME_INPUT` | `instagram_accounts`, `tiktok_accounts` | Terdeteksi duplikasi username pada input sosial akun. |

### Contoh Payload Berhasil (Update)
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "user_id": "12345678",
    "nama": "Budi",
    "insta": "budi.cicero",
    "tiktok": "@budi.cicero",
    "instagram_accounts": ["budi.cicero", "budi_backup"],
    "tiktok_accounts": ["@budi.cicero", "@budi.backup"],
    "whatsapp": "6281234567890",
    "email": "budi@mail.com"
  }
}
```

### Contoh Payload Gagal (Validasi)
```json
{
  "success": false,
  "error_code": "CLAIM_USERNAME_BLOCKED",
  "field": "instagram_accounts",
  "message": "Username cicero_devs tidak diperbolehkan."
}
```
- **Catatan:** Kredensial yang sama dipakai sebagai autentikasi update; mekanisme OTP email sudah dihapus.

## Login User Setelah Claim
- **Endpoint:** `POST /api/auth/user-login`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Catatan:** Setelah registrasi claim berhasil, user login hanya memakai NRP + password.
