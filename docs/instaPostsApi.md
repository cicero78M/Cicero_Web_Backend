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
- Data yang dikembalikan hanya post dengan basis tanggal WIB dari `COALESCE(original_created_at, created_at)`.
- Response mengikuti format `sendSuccess` (lihat `src/utils/response.js`).
- Sinkronisasi cron fetch melakukan penghapusan aman (safe-delete) untuk post `source_type='cron_fetch'` yang tidak muncul lagi di hasil fetch harian.

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

## Penjelasan Skema `insta_post` (baru)

### Perbedaan `created_at` vs `original_created_at`
- `original_created_at`: timestamp asli waktu konten dipublikasikan di Instagram (misalnya dari `taken_at` RapidAPI).
- `created_at`: timestamp saat data disimpan/di-update di backend (waktu sinkronisasi sistem).
- Untuk filter harian pada sinkronisasi fetch, basis tanggal menggunakan `COALESCE(original_created_at, created_at)` dengan timezone WIB agar konsisten.

### Peran `source_type`
- `source_type='cron_fetch'`: post berasal dari sinkronisasi cron/API fetch.
- `source_type='manual_input'`: post berasal dari input manual. Data tipe ini dipertahankan saat proses sinkronisasi delete otomatis.

### Relasi `insta_post_clients`
- Hubungan post-client disimpan di junction table `insta_post_clients`.
- Satu shortcode bisa terhubung ke lebih dari satu client, sehingga query harian untuk likes/fetch menggunakan join tabel ini.
- Penghapusan sinkronisasi melepas relasi client-post terlebih dahulu, lalu baru menghapus baris `insta_post` jika memang sudah tidak punya relasi client lain.

### Aturan Safe-Delete
- Delete kandidat hanya diproses jika fetch sukses dan ada indikasi data valid.
- Skip delete jika:
  - kandidat melebihi threshold maksimum per client (`IG_SAFE_DELETE_MAX_PER_CLIENT`), atau
  - terindikasi partial response (misalnya hasil fetch harian kosong padahal DB punya data, atau response mentok di limit fetch), atau
  - terdeteksi drastic drop terhadap baseline data client (`IG_SAFE_DELETE_DRASTIC_DROP_RATIO`, `IG_SAFE_DELETE_MIN_BASELINE`).
- Delete otomatis hanya berlaku untuk data `source_type='cron_fetch'`; `manual_input` tidak ikut terhapus.

## Handler Fetch Likes Instagram (internal)

Handler `handleFetchLikesInstagram` (file `src/handler/fetchengagement/fetchLikesInstagram.js`) mengambil daftar shortcode harian dari relasi post-client melalui junction table `insta_post_clients`, bukan langsung dari kolom `insta_post.client_id`.

### Perilaku Query Shortcode Harian
- Source shortcode: `insta_post p JOIN insta_post_clients pc ON pc.shortcode = p.shortcode`.
- Filter client: `pc.client_id = $1`.
- Filter tanggal harian mengikuti basis WIB (Asia/Jakarta) dengan ekspresi `(COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $2::date`.
- `SELECT DISTINCT` dipakai untuk mencegah duplikasi shortcode saat terdapat lebih dari satu relasi client pada tabel junction.

### Catatan Logging Error
- Logging error di handler likes IG sekarang selalu mengirim `client_id` nullable (`client_id || null`) agar telemetry tetap konsisten ketika parameter kosong.
