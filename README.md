# TMII Tiket

Konsep situs pemesanan tiket Taman Mini Indonesia Indah berdasarkan mockup Figma "Web Ticketing TMII". Dibangun dengan HTML, CSS, dan JavaScript modular tanpa proses build.

## Cara menjalankan

Situs ini sekarang punya server dan database beneran, jadi jalankan lewat server Node.js, bukan Live Server lagi.

Syarat: Node.js versi 22 atau lebih baru (cek dengan `node --version`).

Di terminal VS Code, dari folder `tmii-ticketing`:

```bash
node server.js
```

Lalu buka **http://localhost:3000** di peramban. Biarkan terminal tetap menyala selama situs dipakai. Tekan `Ctrl+C` untuk berhenti.

Saat pertama kali dijalankan, server membuat database SQLite di `data/tmii.db` dan mengisinya dengan 3 pesanan contoh. Akun yang didaftarkan, sesi masuk, dan semua pesanan tersimpan di database itu, jadi tetap ada walaupun server dimatikan dan dinyalakan lagi, dan bisa dibuka dari peramban mana pun selama server jalan.

## Super Admin

Masuk dengan akun bawaan ini:

- Email: `superadmin.nurdin@tmii.id`
- Kata sandi: `admin123` (segera ganti untuk pemakaian sungguhan)

Akun Admin bawaan (peran Admin, masuk ke panel admin): email `admin.nurdin@tmii.id`, kata sandi `admin123`.

Setelah masuk, menu **Super Admin** muncul di menu profil. Di sana admin bisa melihat ringkasan (jumlah pengguna dan pesanan), melihat, mengubah, dan menghapus pengguna, serta melihat, mengubah status dan tanggal, dan menghapus pesanan. Semua perubahan langsung tersimpan di database. Akun pengguna biasa tidak bisa membuka halaman ini.

## Payment gateway (Midtrans sandbox, buat tes bayar)

Sudah disambungkan ke Midtrans mode sandbox (uang mainan, bukan uang beneran).
Kalau kunci belum diatur, pembayaran jatuh ke mode contoh seperti sebelumnya.

Cara mengaktifkan:

1. Daftar gratis di https://dashboard.midtrans.com (pilih mode Sandbox)
2. Buka Settings, lalu Access Keys. Salin **Server Key** dan **Client Key** (yang berawalan `SB-Mid-...`)
3. Jalankan server dari PowerShell dengan kunci itu (di jendela terminal yang sama):

```powershell
$env:MIDTRANS_SERVER_KEY="SB-Mid-server-..."
$env:MIDTRANS_CLIENT_KEY="SB-Mid-client-..."
node server.js
```

Di terminal akan tertulis `Payment gateway: Midtrans sandbox AKTIF.`
Kunci jangan ditulis ke dalam berkas kode dan jangan dibagikan.

Cara tes bayar:

1. Buat pesanan seperti biasa, klik **Bayar sekarang**. Jendela pembayaran Midtrans (Snap) akan terbuka, pilihan QRIS, dompet digital, transfer bank, dan kartu tampil di dalamnya
2. Cara paling gampang: pilih **QRIS**, lalu bayar pakai Simulator QRIS Midtrans (di dashboard sandbox ada menu Simulator), atau pilih kartu dan pakai kartu tes Midtrans `4811 1111 1111 1114`, masa berlaku bulan/tahun mendatang, CVV `123`
3. Setelah berhasil, kamu dibawa ke halaman Pembayaran Berhasil dan status pesanan jadi Sudah dibayar

Catatan jujur: webhook Midtrans (`/api/payments/notification`, tanda tangan diverifikasi)
sudah dibuat, tapi Midtrans tidak bisa menjangkau `localhost`, jadi selama tes lokal
status lunas diperbarui lewat tombol sukses di jendela pembayaran. Begitu situs ini
dipasang di alamat publik, webhook mengambil alih dan URL notifikasinya diatur di
dashboard Midtrans ke `https://alamat-situs/api/payments/notification`.

## Melihat database

Database tersimpan sebagai satu berkas: `data/tmii.db` di dalam folder proyek. Cara melihat isinya:

1. Lewat menu **Super Admin** di situs (paling gampang, tampilannya tabel rapi).
2. Pakai aplikasi **DB Browser for SQLite** (gratis): buka berkas `data/tmii.db`, isi tabel `users`, `orders`, dan `sessions` bisa dilihat dan diubah dari sana. Tutup dulu server sebelum mengubah dari aplikasi ini supaya tidak berbenturan.
3. Pakai ekstensi **SQLite Viewer** di VS Code, lalu klik berkas `data/tmii.db`.

## Alur yang sudah dibuat

1. Beranda (`index.html`): hero dengan background foto, pencarian tiket, cara pesan, dan pintu masuk ke halaman lain.
2. Halaman terpisah: Tiket (`tiket.html`) dan Tentang (`tentang.html`). Galeri tampil sebagai slideshow di Beranda. Fasilitas, Lokasi dengan peta Google Maps, dan Kontak tetap menjadi bagian di Beranda, tidak dipisah.
2. Masuk dan Daftar: akun tersimpan di database SQLite lewat server. Menu Tiket hanya bisa dibuka setelah masuk.
3. Profil: data akun dan menu Profil Saya serta Pesanan Saya. Menu e-tiket terpisah tidak dibuat.
4. Pesanan Saya: filter Semua, Belum Selesai, dan Selesai. Pesanan belum dibayar dapat dilanjutkan ke pembayaran; pesanan selesai dapat membuka e-tiket.
5. Data Pemesanan: terpisah dari e-tiket. Pengunjung memilih jumlah tiket, mengisi nama, WhatsApp, dan email, lalu memilih metode pembayaran.
6. Pembayaran Berhasil: setelah pembayaran contoh selesai, halaman menyatakan e-tiket otomatis dikirim ke email pemesan.
7. E-Tiket: QR dibuat di peramban, dapat diunduh sebagai PDF, dan dapat dikirim ulang ke email pada versi produksi.
8. Cek Pesanan: keadaan awal, memuat, ditemukan, dan tidak ditemukan.

## Struktur proyek

Setiap halaman berdiri sendiri sebagai berkas HTML terpisah, bukan satu halaman gabungan. Navigasi antar halaman memakai tautan biasa.

```text
tmii-ticketing/
  server.js               Server Node.js + API + database SQLite
  package.json
  data/                   Dibuat otomatis saat server pertama jalan
    tmii.db               Database SQLite (akun, sesi, pesanan)
  index.html              Beranda (termasuk bagian Fasilitas, Lokasi, Kontak)
  tiket.html              Katalog tiket dan keranjang
  tentang.html            Tentang TMII
  masuk.html              Masuk akun
  daftar.html             Daftar akun
  profil.html             Profil saya
  pesanan.html            Pesanan saya
  pemesanan.html          Data pemesanan
  pembayaran-berhasil.html  Konfirmasi pembayaran dan info kirim email
  e-tiket.html            E-tiket dengan QR dan unduhan PDF (pakai ?kode=)
  cek-pesanan.html        Cek pesanan
  assets/
    CREDITS.md
    danau-archipelago.jpg
    rumah-gadang.jpg
    anjungan-aceh.jpg
    istana-anak.jpg
    rumah-tongkonan.jpg
    tirta-cerita.jpg
  src/
    css/
      tokens.css
      base.css
      layout.css
      components.css
      pages.css
      responsive.css
      print.css
    js/
      main.js             Header, footer, dan aksi global semua halaman
      components.js
      data.js
      store.js
      utils.js
      pages/
        beranda.js        tiket.js (halaman katalog)
        masuk.js          daftar.js
        profil.js         pesanan.js
        pemesanan.js      sukses.js
        etiket.js         cek-pesanan.js
        account.js        booking.js
        lookup.js         ticket.js (e-tiket dan PDF)
```

## Batas versi contoh

- Harga, tanggal, kode, dan pesanan bawaan adalah contoh, bukan data resmi TMII.
- Akun dan pesanan sekarang tersimpan di database SQLite (`data/tmii.db`) lewat server Node.js. Keranjang dan sesi masuk tetap disimpan lokal di peramban.
- Kata sandi di-hash SHA-256 di peramban sebelum dikirim ke server. Untuk produksi sungguhan, hashing harus dilakukan di server (misalnya bcrypt), memakai HTTPS, dan ada batas percobaan masuk.
- Pembayaran sudah tersambung ke Midtrans sandbox untuk tes (lihat bagian Payment gateway di atas); untuk produksi pakai kunci mode live dan URL notifikasi publik. Pengiriman email masih simulasi: untuk produksi, kirim email dari server setelah pembayaran terverifikasi dan lampirkan PDF e-tiket pada email tersebut.
- Foto kawasan memakai berkas Wikimedia Commons yang dirujuk dari halaman Wikipedia TMII, disimpan lokal di folder `assets` lengkap dengan kredit dan lisensinya di `assets/CREDITS.md`. Periksa kembali lisensi dan atribusi setiap foto sebelum pemakaian komersial.
- Tanggal contoh diperbaiki mengikuti kalender: 26 Desember 2026 adalah Sabtu dan 27 Desember 2026 adalah Minggu.
