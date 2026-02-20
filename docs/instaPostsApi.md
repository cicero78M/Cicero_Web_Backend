# Instagram Posts API

## GET /api/insta/posts

Mengembalikan daftar post Instagram untuk client pada **hari ini** (timezone Asia/Jakarta) agar payload tidak terlalu besar.

### Query Params
- `client_id` (wajib): ID client. Contoh: `KEDIRI`.

### Contoh Request
```
GET /api/insta/posts?client_id=KEDIRI
```

### Catatan Perilaku
- Data yang dikembalikan hanya post dengan `created_at` pada tanggal hari ini (Asia/Jakarta).
- Response mengikuti format `sendSuccess` (lihat `src/utils/response.js`).
- Sinkronisasi cron fetch post akan menghapus konten hari ini yang tidak lagi ada di hasil fetch, termasuk membersihkan data terkait (likes, komentar, dan audit like) agar tidak terkena kendala foreign key saat post dihapus.

## GET /api/instagram/posts

Endpoint baru untuk mengambil daftar post Instagram dengan rentang tanggal dan opsi filter `role`, `scope`, serta `regional_id`.

### Query Params
- `client_id` (wajib): ID client atau direktorat. Contoh: `DITBINMAS`.
- `periode` (opsional): `harian` (default), `mingguan`, `bulanan`, atau `semua`.
- `tanggal` (opsional): Tanggal referensi (format `YYYY-MM-DD` atau `YYYY-MM` untuk bulanan).
- `start_date` dan `end_date` (opsional): Rentang tanggal (`YYYY-MM-DD`). Jika dua-duanya diisi, `periode` diabaikan.
- `role` (opsional, wajib jika `scope` diisi): Role yang digunakan untuk filter direktorat. Contoh: `ditbinmas`.
- `scope` (opsional): `org` (default) atau `direktorat`. Jika `direktorat`, maka pencarian memakai `role`.
- `regional_id` (opsional): Filter berdasarkan wilayah client (huruf besar), contoh `JATIM`.

### Contoh Request
```
GET /api/instagram/posts?client_id=DITBINMAS&start_date=2025-10-01&end_date=2025-10-31&scope=DIREKTORAT&role=ditbinmas&regional_id=JATIM
```

### Catatan Perilaku
- Jika `scope=direktorat` dan `role` diisi, pencarian memakai filter role pada relasi `insta_post_roles`. Jika tidak ada hasil, sistem fallback ke pencarian berdasarkan `client_id` untuk direktorat terkait.
- Jika `scope=org` dengan `role=operator`, maka `client_id` dari token pengguna dipakai agar sesuai hak akses.
- Hanya post yang sesuai periode atau rentang tanggal yang dikembalikan. Response memakai format `sendSuccess`.


## Handler Fetch Likes Instagram (internal)

Handler `handleFetchLikesInstagram` (file `src/handler/fetchengagement/fetchLikesInstagram.js`) mengambil daftar shortcode harian dari relasi post-client melalui junction table `insta_post_clients`, bukan langsung dari kolom `insta_post.client_id`.

### Perilaku Query Shortcode Harian
- Source shortcode: `insta_post p JOIN insta_post_clients pc ON pc.shortcode = p.shortcode`.
- Filter client: `pc.client_id = $1`.
- Filter tanggal harian mengikuti basis WIB (Asia/Jakarta) dengan ekspresi `(p.created_at AT TIME ZONE 'Asia/Jakarta')::date = $2::date`.
- `SELECT DISTINCT` dipakai untuk mencegah duplikasi shortcode saat terdapat lebih dari satu relasi client pada tabel junction.

### Catatan Logging Error
- Logging error di handler likes IG sekarang selalu mengirim `client_id` nullable (`client_id || null`) agar telemetry tetap konsisten ketika parameter kosong.
