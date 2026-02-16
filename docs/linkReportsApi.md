# Link Reports API
*Last updated: 2026-02-16 (update resolusi `client_id` endpoint `POST /api/link-reports-khusus`)*

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
Membuat link report khusus (hanya `instagram_link`).

### Autentikasi
Endpoint ini **wajib** menggunakan Bearer token (`Authorization: Bearer <token>`).

### Field Request
- `instagram_link` (**wajib**): URL post/reel Instagram yang valid.
- `client_id` (opsional untuk token role `user`): jika tidak dikirim, backend akan resolve otomatis dari profil user di DB berdasarkan `req.user.user_id`.
- `user_id` (kondisional): kirim jika proses insert link report khusus masih membutuhkan `user_id` eksplisit dari request.

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

### Field yang Dilarang untuk Mode Khusus
Field berikut tidak boleh dikirim untuk endpoint khusus ini:
- `facebook_link`
- `twitter_link`
- `tiktok_link`
- `youtube_link`

Jika salah satu field tersebut dikirim, request dianggap invalid dan API dapat mengembalikan `400`.

### Contoh Request Sukses (201)
```
POST /api/link-reports-khusus
Authorization: Bearer <token>
Content-Type: application/json

{
  "instagram_link": "https://www.instagram.com/p/DSl7lfmgd14/",
  "client_id": "cicero-client-01",
  "user_id": "84110583"
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
  "message": "Invalid request",
  "errors": [
    "instagram_link harus URL post Instagram yang valid",
    "facebook_link tidak diizinkan untuk mode khusus"
  ]
}
```
