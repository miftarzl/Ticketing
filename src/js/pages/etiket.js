import { fetchOrder, fetchRotatingQr, guestContact } from "../store.js";
import { qs } from "../utils.js";
import { mountTicket, qrImageDataURL, renderTicket } from "./ticket.js";
const code = new URLSearchParams(window.location.search).get("kode") || "";
const root = qs("#main");
let order = null;
try {
  order = await fetchOrder(code, guestContact());
} catch {
  order = null;
}
root.innerHTML = renderTicket(order) || `
  <div class="container">
    <div class="page-head"><h1>E-tiket tidak ditemukan</h1><p>Kode pesanan di alamat ini tidak cocok dengan data di database, atau pesanan ini bukan milik kamu.</p></div>
    <div class="card empty-state"><h3>Coba cek pesanan kamu</h3><p>Gunakan kode dari email atau halaman pesanan saya.</p><a class="btn btn-primary" href="cek-pesanan.html">Cek pesanan</a></div>
  </div>`;
mountTicket(order);


// QR dinamis: token diganti tiap 30 detik dari server, plus jam berjalan,
// supaya petugas bisa membedakan halaman asli dari tangkapan layar.
if (order?.status === "paid" && order.ticket) {
  const clock = document.querySelector("[data-live-clock]");
  if (clock) {
    const tickClock = () => {
      clock.textContent = new Date().toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour12: false,
      });
    };
    tickClock();
    window.setInterval(tickClock, 1000);
  }
  const fill = document.querySelector("#qr-rotate-fill");
  const rotate = async () => {
    try {
      const { token, refreshIn } = await fetchRotatingQr(order.code);
      const qrUrl = qrImageDataURL(token);
      if (qrUrl) {
        const image = document.querySelector("#ticket-qr");
        if (image) image.src = qrUrl;
      }
      if (fill) {
        fill.style.animation = "none";
        void fill.offsetWidth;
        fill.style.animation = `qr-fill ${refreshIn}s linear forwards`;
      }
      window.setTimeout(rotate, refreshIn * 1000);
    } catch {
      // Server tidak terjangkau: QR statis dari payload awal tetap berlaku
    }
  };
  rotate();
}
