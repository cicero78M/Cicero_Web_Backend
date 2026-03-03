# OSINT Preflight Troubleshooting (`theHarvester ENOENT`)

## Scope

Dokumen ini untuk insiden ketika service **cicero-osint** gagal start dengan error seperti:

- `spawn ./.venv/bin/theHarvester ENOENT`
- `Sherlock/Holehe/theHarvester/Infoga/EXIFTOOL_CMD command tidak siap`

Catatan: repository `Cicero_Web_Backend` tidak memuat source code service `cicero-osint`. Karena itu, validasi dan perbaikan dilakukan di host/service `cicero-osint` langsung.

## Gejala yang perlu diverifikasi

1. Cek status PM2:

```bash
pm2 list
pm2 logs osint --lines 100
```

2. Pastikan proses berjalan di direktori project osint yang benar:

```bash
pm2 show osint
```

Periksa nilai `script path` dan `cwd`.

## Root cause paling umum

Error `ENOENT` menunjukkan executable tidak ditemukan. Pada kasus ini target executable adalah:

- `./.venv/bin/theHarvester`

Artinya salah satu dari kondisi berikut terjadi:

1. Virtualenv `.venv` belum dibuat.
2. Dependency Python belum terpasang di `.venv`.
3. PM2 menjalankan process dari `cwd` yang salah.
4. Paket sistem `exiftool` belum terpasang.

## Langkah perbaikan (di server OSINT)

1. Masuk ke direktori service osint:

```bash
cd /home/cpdn/cicero-osint
```

2. Pastikan virtualenv ada:

```bash
python3 -m venv .venv
```

3. Aktifkan virtualenv dan install dependency:

```bash
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

4. Verifikasi binary yang dibutuhkan:

```bash
test -x .venv/bin/theHarvester && echo "theHarvester OK" || echo "theHarvester MISSING"
test -x .venv/bin/holehe && echo "holehe OK" || echo "holehe MISSING"
test -x .venv/bin/infoga && echo "infoga OK" || echo "infoga MISSING"
```

5. Pasang EXIFTool di Ubuntu jika belum ada:

```bash
sudo apt-get update
sudo apt-get install -y libimage-exiftool-perl
command -v exiftool
```

6. Restart PM2 process:

```bash
pm2 restart osint
pm2 logs osint --lines 100
```

## Hardening rekomendasi

- Set `cwd` process PM2 osint ke `/home/cpdn/cicero-osint` supaya path relatif `./.venv/bin/...` selalu valid.
- Lebih aman gunakan path absolut untuk binary tooling (misalnya `/home/cpdn/cicero-osint/.venv/bin/theHarvester`) agar tidak bergantung `cwd`.
- Tambahkan health check startup yang menampilkan path executable yang dipakai saat preflight.

