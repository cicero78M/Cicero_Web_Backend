# Claim API

Dokumen ini merangkum endpoint claim data berbasis NRP dan password (tanpa OTP email dan tanpa username).

## Registrasi Kredensial Claim

- **Endpoint:** `POST /api/claim/register`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Tujuan:** Menghubungkan user ke NRP yang sudah ada di tabel `user`, lalu menyimpan `password_hash` untuk login berbasis NRP.
- **Aturan validasi:**
  - `nrp` dan `password` wajib diisi.
  - `password` minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.

## Profil Claim Terautentikasi

- **Endpoint:** `GET /api/claim/me`
- **Autentikasi:** wajib cookie `HttpOnly` `token` dari `POST /api/auth/user-login`.
- **Identitas:** selalu berasal dari `req.user.user_id`. Nilai `nrp` atau `user_id` pada body
  maupun query string diabaikan dan tidak dapat mengganti identitas token.
- **Catatan client browser:** kirim request dengan `credentials: "include"`; password tidak
  boleh dikirim ulang atau disimpan di Web Storage.

## Perbarui Profil Claim Terautentikasi

- **Endpoint:** `PUT /api/claim/me`
- **Autentikasi dan identitas:** sama dengan `GET /api/claim/me`.
- **Body:** hanya field profil yang ingin diperbarui. Jangan menyertakan `nrp`, `user_id`,
  atau `password` sebagai mekanisme otorisasi.
- **Field dan aturan validasi:** sama dengan daftar claim update di bawah.

## Endpoint Migrasi (Deprecated)

Endpoint berikut dipertahankan sementara untuk kompatibilitas client lama dan **deprecated**.
Client baru wajib memakai endpoint `/api/claim/me` berbasis cookie `HttpOnly`.

### Ambil Data Pengguna (Deprecated)

- **Endpoint:** `POST /api/claim/user-data`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Catatan:** Endpoint menolak jika kombinasi NRP dan password tidak valid.

### Perbarui Data Pengguna (Deprecated)

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

| `error_code`                     | `field`                                                    | Kapan muncul                                                  |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `CLAIM_INVALID_WHATSAPP_FORMAT`  | `whatsapp`                                                 | Nomor WhatsApp tidak valid / digit kurang dari batas minimum. |
| `CLAIM_INVALID_EMAIL_FORMAT`     | `email`                                                    | Format email tidak valid.                                     |
| `CLAIM_INVALID_INSTAGRAM_FORMAT` | `insta`, `instagram_accounts`                              | Format username/link Instagram tidak valid.                   |
| `CLAIM_INVALID_TIKTOK_FORMAT`    | `tiktok`, `tiktok_accounts`                                | Format username/link TikTok tidak valid.                      |
| `CLAIM_USERNAME_BLOCKED`         | `insta`, `tiktok`, `instagram_accounts`, `tiktok_accounts` | Username `cicero_devs` tidak diperbolehkan.                   |
| `CLAIM_DUPLICATE_USERNAME_INPUT` | `instagram_accounts`, `tiktok_accounts`                    | Terdeteksi duplikasi username pada input sosial akun.         |

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

## Konten Engagement yang Belum Diselesaikan

- **Endpoint:** `GET /api/claim/pending-content`
- **Autentikasi:** wajib Bearer token/cookie hasil login user dengan claim `role: "user"`.
- Identitas selalu diambil dari `req.user.user_id`. Parameter `nrp` atau `user_id` dari client
  diabaikan dan tidak pernah digunakan untuk memilih pengguna.
- **Zona waktu:** seluruh filter kalender menggunakan `Asia/Jakarta`, sama dengan rekap
  engagement.

### Filter tanggal

| Query                    | Nilai                                               | Default                     |
| ------------------------ | --------------------------------------------------- | --------------------------- |
| `periode`                | `harian`, `mingguan`, `bulanan`, atau `semua`       | `harian`                    |
| `tanggal`                | `YYYY-MM-DD`; untuk bulanan juga menerima `YYYY-MM` | tanggal sekarang di Jakarta |
| `start_date`, `end_date` | pasangan tanggal inklusif `YYYY-MM-DD`              | tidak digunakan             |

`start_date` dan `end_date` wajib diberikan bersama dan mengambil prioritas atas
`periode`/`tanggal`. Untuk Instagram waktu konten mengikuti rekap likes, yaitu
`COALESCE(created_at, original_created_at)`. Untuk TikTok, konten `manual_input` memakai
`created_at`; sumber lain memakai `COALESCE(original_created_at, created_at)`.

### Scope dan status

- Akun platform berasal dari seluruh record aktif `user_social_accounts` milik user.
- Konten Instagram masuk scope jika terhubung ke client user melalui `insta_post.client_id`
  atau `insta_post_clients`, atau terhubung ke salah satu role user melalui
  `insta_post_roles`.
- Konten TikTok masuk scope jika `tiktok_post.client_id` sama dengan client user atau
  `tiktok_post_roles` cocok dengan salah satu role user.
- Instagram dianggap selesai bila sekurangnya satu username aktif user terdapat dalam
  `insta_like.likes`. TikTok dianggap selesai bila sekurangnya satu username aktif user
  terdapat dalam `tiktok_comment.comments`. Pencocokan tidak peka huruf besar/kecil dan
  mengabaikan awalan `@`.
- `items` hanya berisi konten berstatus **pending**. `total_content`, `completed_content`,
  dan `pending_content` menjelaskan keseluruhan scope; `completed_ids` memuat ID yang telah
  selesai.
- Jika user tidak mempunyai username untuk platform tersebut, API mengembalikan
  `username_available: false`, seluruh hitungan `0`, dan `items: []`.
- URL Instagram dibentuk dari shortcode yang tersedia. Schema terdokumentasi TikTok hanya
  menyediakan `video_id` tanpa author/URL tervalidasi, sehingga `url` TikTok selalu `null`.

### Response berhasil

```json
{
  "success": true,
  "data": {
    "user_id": "12345678",
    "timezone": "Asia/Jakarta",
    "filters": {
      "periode": "harian",
      "tanggal": null,
      "start_date": null,
      "end_date": null
    },
    "instagram": {
      "username_available": true,
      "usernames": ["akun.utama", "akun.cadangan"],
      "total_content": 2,
      "completed_content": 1,
      "pending_content": 1,
      "items": [
        {
          "shortcode": "ABC123",
          "url": "https://www.instagram.com/p/ABC123",
          "caption": "Caption konten",
          "content_time": "2026-08-07T01:00:00.000Z"
        }
      ],
      "completed_ids": ["DONE123"]
    },
    "tiktok": {
      "username_available": false,
      "usernames": [],
      "total_content": 0,
      "completed_content": 0,
      "pending_content": 0,
      "items": [],
      "completed_ids": []
    }
  }
}
```

### Error response

| HTTP  | `error_code`                | Kondisi                                      |
| ----- | --------------------------- | -------------------------------------------- |
| `401` | `CLAIM_AUTH_USER_REQUIRED`  | Token tidak memuat `user_id`.                |
| `403` | `CLAIM_USER_ROLE_REQUIRED`  | Claim role token bukan `user`.               |
| `404` | `CLAIM_USER_NOT_FOUND`      | User token tidak ditemukan atau tidak aktif. |
| `400` | `CLAIM_INVALID_DATE_FILTER` | Periode/format/rentang tanggal tidak valid.  |

Error internal diteruskan ke error middleware global dan mengikuti format error global.

# Validasi Profil Sosial Claim

## `POST /api/claim/social-profile/validate`

Endpoint ini memeriksa profil sebelum user menyimpan perubahan claim. Endpoint
memerlukan autentikasi yang sama dengan `GET/PUT /api/claim/me`: kirim token JWT
melalui `Authorization: Bearer <token>` atau cookie autentikasi yang berlaku.
Validasi bersifat **read-only** dan tidak menulis tabel `"user"` maupun
`user_social_accounts`. Penyimpanan tetap dilakukan melalui `PUT /api/claim/me`
atau endpoint kompatibilitas yang sudah tersedia.

Request JSON:

```json
{
  "platform": "instagram",
  "username": "https://www.instagram.com/cicero.test/"
}
```

`platform` hanya menerima `instagram` atau `tiktok`. Username dapat berupa
username, username berawalan `@`, atau URL profil. Instagram dinormalisasi ke
huruf kecil tanpa `@`; TikTok dinormalisasi ke huruf kecil dengan awalan `@`.

Response sukses (`200`):

```json
{
  "success": true,
  "data": {
    "platform": "instagram",
    "username": "cicero.test",
    "found": true,
    "profile_name": "Cicero",
    "avatar_url": "https://example.invalid/avatar.jpg",
    "is_private": false,
    "is_verified": false,
    "followers": 100,
    "following": 20,
    "content_count": 10,
    "data_quality": {
      "score": 100,
      "label": "complete",
      "components": [
        { "field": "profile_name", "available": true, "points": 20 }
      ],
      "explanation": "Skor menunjukkan kelengkapan data profil yang tersedia, bukan keaslian akun."
    }
  }
}
```

Setiap komponen yang tersedia (`profile_name`, `avatar_url`, `followers`,
`following`, dan `content_count`) bernilai 20 poin. Labelnya deterministik:
`complete` untuk 100, `partial` untuk 60–80, dan `limited` untuk 0–40. Nilai ini
adalah indikator kelengkapan respons dan **bukan** klaim bahwa akun asli,
terpercaya, atau dimiliki user.

### Error

| HTTP | `error_code`                             | Kondisi                                                            |
| ---- | ---------------------------------------- | ------------------------------------------------------------------ |
| 400  | `CLAIM_SOCIAL_PLATFORM_INVALID`          | Platform tidak didukung.                                           |
| 400  | `CLAIM_SOCIAL_USERNAME_INVALID`          | Format username/URL tidak valid.                                   |
| 401  | error autentikasi middleware             | Token tidak tersedia atau tidak valid.                             |
| 404  | `CLAIM_SOCIAL_PROFILE_NOT_FOUND`         | Provider tidak menemukan profil.                                   |
| 429  | `CLAIM_SOCIAL_UPSTREAM_RATE_LIMITED`     | RapidAPI membatasi permintaan.                                     |
| 429  | `CLAIM_SOCIAL_VALIDATION_RATE_LIMITED`   | Batas endpoint 10 request per 60 detik per client terlampaui.      |
| 502  | `CLAIM_SOCIAL_UPSTREAM_UNAVAILABLE`      | RapidAPI gagal atau responsnya tidak dapat digunakan.              |
| 503  | `CLAIM_SOCIAL_CONFIGURATION_UNAVAILABLE` | Konfigurasi RapidAPI yang sudah digunakan aplikasi tidak tersedia. |

Endpoint hanya mengembalikan DTO di atas; payload dan pesan error mentah dari
provider tidak diteruskan. Konfigurasi primary/fallback sepenuhnya mengikuti
service RapidAPI yang sudah ada. Fallback hanya dijalankan bila service existing
mendukungnya; jika fallback tidak tersedia atau ikut gagal, endpoint mengembalikan
kode konfigurasi/gangguan yang sesuai tanpa menyimpan data.
