import { spawnConfetti } from "../components.js";
import { ACCOUNTS_ENABLED, fetchOrder, guestContact } from "../store.js";
import { qs } from "../utils.js";
import { renderPaymentSuccess } from "./booking.js";
const code = new URLSearchParams(window.location.search).get("kode") || "";
const ONCE_KEY = "tmii-success-once";
// Halaman ini hanya tampil SEKALI: tepat setelah pembayaran lunas.
// Alur pembayaran memasang bendera sekali pakai berisi kode pesanan ini
// sebelum pindah ke sini; benderanya langsung dihapus begitu halaman
// tampil, jadi kunjungan berikutnya (tautan langsung, segarkan halaman,
// atau tombol Kembali browser) hanya melihat pemberitahuan di bawah.
const allowed = Boolean(code) && sessionStorage.getItem(ONCE_KEY) === code;
if (allowed) sessionStorage.removeItem(ONCE_KEY);
let order = null;
try {
  order = await fetchOrder(code, guestContact());
} catch {
  order = null;
}
if (allowed && order?.status === "paid") {
  qs("#main").innerHTML = renderPaymentSuccess(order);
  spawnConfetti();
} else if (order?.status === "paid") {
  qs("#main").innerHTML = `
  <div class="container">
    <div class="success-wrap">
      <h1>Pembayaran pesanan ini sudah selesai</h1>
      <p>Halaman pembayaran berhasil hanya tampil satu kali, tepat setelah pembayaran lunas, dan halaman untuk pesanan <strong>${code}</strong> sudah pernah ditampilkan.</p>
      <div class="card card-pad success-card">
        <p>E-tiketmu tetap aman dan bisa dibuka kapan saja:</p>
        <div class="summary-list">
          <div class="summary-row"><span>Kode pesanan</span><span>${code}</span></div>
          <div class="summary-row"><span>Status kirim email</span><span>${order.emailStatus}</span></div>
        </div>
      </div>
      <div class="success-actions">
        <a class="btn btn-primary" href="e-tiket.html?kode=${code}">Lihat e-tiket</a>
        ${ACCOUNTS_ENABLED ? '<a class="btn btn-outline" href="pesanan.html">Pesanan saya</a>' : '<a class="btn btn-outline" href="cek-pesanan.html">Cek pesanan</a>'}
      </div>
      <p class="small muted">Salinan e-tiket juga sudah dikirim ke email pemesan dan bisa diunduh sebagai PDF dari halaman e-tiket.</p>
    </div>
  </div>`;
} else {
  qs("#main").innerHTML = renderPaymentSuccess(order);
}
// Kembali lewat tombol Back browser bisa memulihkan halaman dari cache
// tanpa menjalankan ulang skrip; paksa pindah ke daftar pesanan agar
// aturan sekali tampil tetap berlaku (mode tamu: ke Cek Pesanan).
window.addEventListener("pageshow", (event) => {
  if (event.persisted && order?.status === "paid" && !allowed) {
    window.location.replace(ACCOUNTS_ENABLED ? "pesanan.html" : "cek-pesanan.html");
  }
});
