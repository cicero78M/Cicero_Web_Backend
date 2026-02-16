# Link Reports API
*Last updated: 2026-02-16 (pemurnian konteks tugas khusus: fetch post khusus tidak lagi mirror ke insta_post)*

Dokumen ini menjelaskan endpoint untuk mengambil data link report.

## GET /api/link-reports
Mengembalikan daftar link report, termasuk pagination.

### Query Parameters
- `user_id` (opsional): filter berdasarkan user yang mengirim link report.
- `post_id` (opsional): filter berdasarkan shortcode post Instagram (nilai yang sama dengan `insta_post.shortcode`).
- `shortcode` (opsional): alias dari `post_id`.
- `limit` (opsional): jumlah data per halaman. Default `20`.
- `page` (opsional): nomor halaman. Default `1`.
- `offset` (opsional): offset data. Jika diisi, `page` akan diabaikan.

### Contoh Request
```
GET /api/link-reports?user_id=84110583&post_id=DSliyYzE10o
```

### Contoh Response
```
{
  "success": true,
  "data": {
    "items": [
      {
        "shortcode": "DSliyYzE10o",
        "user_id": "84110583",
        "instagram_link": "https://instagram.com/...",
        "facebook_link": null,
        "twitter_link": null,
        "tiktok_link": null,
        "youtube_link": null,
        "created_at": "2025-09-26T10:00:00.000Z",
        "caption": "...",
        "image_url": "...",
        "thumbnail_url": "..."
      }
    ],
    "pagination": {
      "total": 1,
      "limit": 20,
      "offset": 0,
      "page": 1,
      "totalPages": 1
    }
  }
}
```

## GET /api/link-reports-khusus
Mengembalikan daftar link report khusus untuk post Instagram khusus.

### Query Parameters
- `user_id` (opsional): filter berdasarkan user yang mengirim link report khusus.
- `post_id` (opsional): filter berdasarkan shortcode post Instagram khusus (nilai yang sama dengan `insta_post_khusus.shortcode`).
- `shortcode` (opsional): alias dari `post_id`.

### Contoh Request
```
GET /api/link-reports-khusus?user_id=84110583&post_id=DSl7lfmgd14
```

### Contoh Response
```
{
  "success": true,
  "data": [
    {
      "shortcode": "DSl7lfmgd14",
      "user_id": "84110583",
      "instagram_link": "https://instagram.com/...",
      "facebook_link": null,
      "twitter_link": null,
      "tiktok_link": null,
      "youtube_link": null,
      "created_at": "2025-09-27T10:00:00.000Z",
      "caption": "...",
      "image_url": "...",
      "thumbnail_url": "..."
    }
  ]
}
```

## POST /api/link-reports-khusus
Membuat laporan link pelaksanaan tugas khusus berbasis post Instagram.

### Autentikasi
Endpoint ini **wajib** menggunakan Bearer token (`Authorization: Bearer <token>`).

### Field Request
- `instagram_link` (wajib): URL post/reel Instagram yang valid. Backend akan ekstrak shortcode sebagai referensi tugas.
- `facebook_link`, `twitter_link`, `tiktok_link`, `youtube_link` (opsional): URL platform non-Instagram.
- Minimal satu link sosial harus terisi (`instagram_link`/`facebook_link`/`twitter_link`/`tiktok_link`/`youtube_link`).
- `client_id` (opsional untuk token role `user`): jika tidak dikirim, backend akan resolve otomatis dari profil user di DB berdasarkan `req.user.user_id`.
- `user_id` (**tidak digunakan**): untuk role `user`, backend selalu mengambil `user_id` dari token (`req.user.user_id`) dan mengabaikan `user_id` dari request body.
- `target_user_id` (kondisional, wajib untuk role non-`user` seperti dashboard/operator): user tujuan pelaporan. Backend akan validasi bahwa user tujuan berada pada `client_id` yang diizinkan oleh token.

### Tabel Rule Validasi Ringkas
| Field | Required | Rule |
| --- | --- | --- |
| `instagram_link` | Wajib | Harus URL Instagram post/reel valid; backend ekstrak `shortcode`. |
| `facebook_link` | Opsional | Diperbolehkan sebagai link non-Instagram. |
| `twitter_link` | Opsional | Diperbolehkan sebagai link non-Instagram. |
| `tiktok_link` | Opsional | Diperbolehkan sebagai link non-Instagram. |
| `youtube_link` | Opsional | Diperbolehkan sebagai link non-Instagram. |
| `target_user_id` | Kondisional | Wajib untuk role non-`user` (dashboard/operator). |

Aturan one-of link:
- Request **diterima** jika minimal satu dari lima link sosial terisi.
- Request **ditolak** jika semua link sosial kosong (`400 At least one social media link is required`).


### Resolusi `user_id`
Backend meresolusi `user_id` dengan kebijakan berikut:
1. **Role `user`**: `user_id` selalu diambil dari token (`req.user.user_id`). Nilai `user_id` di body diabaikan.
2. **Role non-user (mis. dashboard/operator)**: wajib kirim `target_user_id`.
3. Untuk role non-user, penggunaan `user_id` langsung di body akan ditolak (`400`) agar kontrak API konsisten dan eksplisit.

Validasi otorisasi `target_user_id`:
- `target_user_id` harus ada di DB.
- `target_user_id` harus berada pada `client_id` yang sama dengan `client_id` hasil resolusi token/request.
- Jika tidak lolos validasi, API mengembalikan `403` atau `422` sesuai tipe kegagalan.

### Resolusi `client_id`
Backend meresolusi `client_id` dengan prioritas berikut:
1. `req.body.client_id` (jika ada, divalidasi)
2. lookup `client_id` dari tabel `"user"` berdasarkan `req.user.user_id`
3. `req.query.client_id` hanya untuk backward compatibility (dipakai untuk role non-user atau validasi kecocokan)

Kebijakan source of truth:
- **Role `user`**: source of truth adalah `client_id` milik user di DB. Jika `req.body.client_id`/`req.query.client_id` dikirim dan tidak sama dengan profil user, request ditolak (`403`).
- **Role dashboard/operator**: tetap mengikuti resolusi umum dengan guard `client_ids`.

Jika hasil resolusi tetap kosong (khusus role non-user), API mengembalikan `400 client_id is required`.

### Guard multi-client token
Jika token memiliki `client_ids` (umumnya dashboard/operator), maka `client_id` hasil resolusi harus termasuk dalam daftar tersebut.
Jika tidak termasuk, API akan mengembalikan `403 client_id tidak diizinkan`.


### Policy Periode Pelaporan (Mode Khusus)
Validasi periode untuk `POST /api/link-reports-khusus` menggunakan umur konten (`insta_post_khusus.created_at`) dalam jendela waktu rolling **2 hari terakhir**, bukan lagi strict tanggal hari ini.

Kondisi yang diterapkan:
- Post dengan `shortcode` harus ada di `insta_post_khusus`.
- `insta_post_khusus.created_at >= (NOW() AT TIME ZONE 'Asia/Jakarta') - INTERVAL '2 days'`.
- `shortcode` dapat berasal dari ekstraksi `instagram_link`, atau langsung dari payload ketika `instagram_link` tidak dikirim.

Jika nantinya business rule berubah menjadi berbasis assignment harian, enforcement disarankan dilakukan berdasarkan entitas tugas (mis. `assignment_date`) alih-alih tanggal konten Instagram.

### Validasi Link
- Minimal satu link sosial (`instagram_link`/`facebook_link`/`twitter_link`/`tiktok_link`/`youtube_link`) wajib terisi.
- Backend **tidak** menjalankan mekanisme upload/fetch tugas khusus pada endpoint ini.
- Endpoint ini hanya menyimpan laporan link pelaksanaan tugas ke `link_report_khusus` dengan identitas utama `(shortcode, user_id)`.
- Sumber referensi laporan khusus murni dari `insta_post_khusus`. Proses input/fetch post khusus tidak melakukan mirror/upsert ke tabel `insta_post` agar konteks tugas rutin dan tugas khusus tetap terpisah.
- Jika seluruh field link kosong, backend mengembalikan `400` (`At least one social media link is required`).
- Jika `instagram_link` tidak dikirim, backend tetap menerima request selama `shortcode` dikirim dan valid.

### Contoh Request Sukses (201)
```
POST /api/link-reports-khusus
Authorization: Bearer <token>
Content-Type: application/json

{
  "instagram_link": "https://www.instagram.com/p/DSl7lfmgd14/",
  "facebook_link": "https://www.facebook.com/share/p/1A2B3C4D5E/",
  "tiktok_link": "https://www.tiktok.com/@akun/video/7499999999999999999",
  "client_id": "cicero-client-01"
}
```


### Contoh Request Role Non-User (dashboard/operator)
```
POST /api/link-reports-khusus
Authorization: Bearer <token-dashboard/operator>
Content-Type: application/json

{
  "instagram_link": "https://www.instagram.com/p/DSl7lfmgd14/",
  "facebook_link": "https://www.facebook.com/share/p/1A2B3C4D5E/",
  "client_id": "cicero-client-01",
  "target_user_id": "84110583"
}
```

### Contoh Response Sukses (201)
```
{
  "success": true,
  "message": "Link report khusus berhasil dibuat",
  "data": {
    "shortcode": "DSl7lfmgd14",
    "instagram_link": "https://www.instagram.com/p/DSl7lfmgd14/",
    "facebook_link": "https://www.facebook.com/share/p/1A2B3C4D5E/",
    "tiktok_link": "https://www.tiktok.com/@akun/video/7499999999999999999",
    "assignment_id": null,
    "client_id": "cicero-client-01",
    "user_id": "84110583",
    "created_at": "2026-02-11T09:10:00.000Z"
  }
}
```

### Contoh Error Input Invalid (400)
```
{
  "success": false,
  "message": "At least one social media link is required"
}
```

### Contoh Error shortcode wajib saat instagram_link kosong (400)
```
{
  "success": false,
  "message": "shortcode is required when instagram_link is empty"
}
```


### Contoh Error Policy Periode (400)
```
{
  "success": false,
  "message": "laporan ditolak: konten di luar periode pelaporan (2 days)"
}
```

### Contoh Error Shortcode Tidak Ditemukan (400)
```
{
  "success": false,
  "message": "shortcode not found"
}
```

### Kompatibilitas untuk Frontend
- Tidak ada lagi kewajiban mengirim `instagram_link` pada endpoint khusus.
- Jika tidak mengirim `instagram_link`, frontend wajib mengirim `shortcode` yang valid dari `insta_post_khusus`.
