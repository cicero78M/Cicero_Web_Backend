# Link Reports API
*Last updated: 2026-02-11*

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

### Resolusi `client_id`
Untuk endpoint ini, backend meresolusi `client_id` secara berurutan:
1. `req.body.client_id`
2. `req.query.client_id`
3. `req.user.client_id` (dari token `authRequired`)

Jika ketiganya kosong, API akan mengembalikan `400 client_id is required`.

### Guard multi-client token
Jika token memiliki `client_ids`, maka `client_id` hasil resolusi harus termasuk dalam daftar tersebut.
Jika tidak termasuk, API akan mengembalikan `403 client_id tidak diizinkan`.

### Catatan payload
- `instagram_link` wajib diisi dan harus URL post/reel Instagram yang valid.
- Link platform lain (`facebook_link`, `twitter_link`, `tiktok_link`, `youtube_link`) tidak diizinkan untuk endpoint khusus ini.
