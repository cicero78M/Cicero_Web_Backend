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
- **Catatan:** Kredensial yang sama dipakai sebagai autentikasi update; mekanisme OTP email sudah dihapus.

## Login User Setelah Claim
- **Endpoint:** `POST /api/auth/user-login`
- **Body:** `{ "nrp": "12345678", "password": "Abcd1234!" }`
- **Catatan:** Setelah registrasi claim berhasil, user login hanya memakai NRP + password.
