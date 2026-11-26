import { ticketById } from "./data.js";
import {
  ACCOUNTS_ENABLED,
  createPaymentToken,
  currentUser,
  fetchPaymentConfig,
  orderTotal,
  payOrder,
} from "./store.js";
import { escapeHTML, formatIDR, formatVisitDate, toast, visitorsText } from "./utils.js";

const NAV_ITEMS = [
  { page: "beranda", label: "Beranda", href: "index.html" },
  { page: "tiket", label: "Tiket", href: "tiket.html" },
  { page: "wahana", label: "Wahana", href: "wahana.html" },
  { page: "tentang", label: "Tentang", href: "tentang.html" },
  { page: "fasilitas", label: "Fasilitas", href: "index.html#fasilitas" },
  { page: "lokasi", label: "Lokasi", href: "index.html#lokasi" },
  { page: "kontak", label: "Kontak", href: "index.html#kontak" },
];

export function renderHeader(activePage = "") {
  const user = currentUser();
  // Selama fitur akun disembunyikan (ACCOUNTS_ENABLED false), kepala situs
  // tidak menampilkan tombol Masuk/Daftar maupun menu profil sama sekali.
  const account = !ACCOUNTS_ENABLED
    ? ""
    : user
    ? `
      <div class="profile-wrap">
        <button class="profile-button" type="button" data-action="profile-toggle" aria-expanded="false" aria-haspopup="true">
          <span class="avatar" aria-hidden="true">${escapeHTML(user.name.trim().charAt(0).toUpperCase())}</span>
          <span>${escapeHTML(user.name.split(" ")[0])}</span>
        </button>
        <div class="profile-menu" data-profile-menu hidden>
          <p><strong>Menu Profil</strong><br><span class="small muted">Tampil setelah pengguna masuk</span></p>
          <a href="profil.html">Profil saya</a>
          <a href="pesanan.html">Pesanan saya</a>
          ${user.role === "superadmin" ? '<a href="admin.html">Super Admin</a>' : ""}
          <button type="button" class="logout" data-action="logout">Keluar</button>
        </div>
      </div>`
    : `
      <a class="header-link" href="masuk.html">Masuk</a>
      <a class="header-link accent" href="daftar.html">Daftar</a>`;

  const navLinks = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" ${item.page === activePage ? 'class="active" aria-current="page"' : ""}>${item.label}</a>`
  ).join("");

  return `
    <div class="header-inner">
      <a class="brand" href="index.html">TMII Tiket</a>
      <nav class="main-nav" aria-label="Navigasi utama">${navLinks}</nav>
      <div class="header-actions">
        <a class="header-link hide-mobile" href="cek-pesanan.html">Cek Pesanan</a>
        ${account}
        <button class="btn btn-primary menu-button" type="button" data-action="mobile-toggle" aria-expanded="false">Menu</button>
      </div>
    </div>
    <div class="mobile-panel" data-mobile-panel>
      <nav aria-label="Navigasi seluler">
        ${navLinks}
        <a href="cek-pesanan.html">Cek Pesanan</a>
        ${!ACCOUNTS_ENABLED ? "" : user ? `<a href="profil.html">Profil saya</a><a href="pesanan.html">Pesanan saya</a>${user.role === "superadmin" ? '<a href="admin.html">Super Admin</a>' : ""}` : `<a href="masuk.html">Masuk</a><a href="daftar.html">Daftar</a>`}
      </nav>
    </div>`;
}

export function renderFooter() {
  return `
    <div class="footer-inner">
      <strong>TMII Tiket. Mockup konsep, belum terbit.</strong>
      <p>Harga, tanggal, dan pesanan di situs ini adalah contoh untuk pengembangan. Foto kawasan berasal dari Wikimedia Commons, kredit lengkap ada di berkas assets/CREDITS.md.</p>
      <p>Kontak resmi dan jam operasional perlu diisi dari kanal resmi TMII sebelum versi ini diterbitkan.</p>
    </div>`;
}

export function statusTag(order) {
  if (order.status === "paid")
    return `<span class="status-tag status-paid">Sudah dibayar</span>`;
  if (order.status === "cancelled")
    return `<span class="status-tag status-cancelled">Dibatalkan</span>`;
  return `<span class="status-tag status-unpaid">Belum dibayar</span>`;
}

export function orderItemsText(order) {
  return order.items
    .map((item) => ticketById(item.id)?.name || item.id)
    .join(" dan ");
}

export function orderCard(order, { showBuyer = false } = {}) {
  const actions =
    order.status === "unpaid"
      ? `
        <button class="btn btn-accent" type="button" data-action="pay-order" data-code="${order.code}">Bayar sekarang</button>
        <button class="btn btn-ghost" type="button" data-action="cancel-order" data-code="${order.code}">Batalkan pesanan</button>`
      : order.status === "paid"
        ? `
        <a class="btn btn-primary" href="e-tiket.html?kode=${order.code}">Lihat e-tiket</a>
        <button class="btn btn-ghost" type="button" data-action="download-pdf" data-code="${order.code}">Unduh PDF</button>`
        : `<span class="muted">Pesanan ini sudah dibatalkan.</span>`;

  return `
    <article class="card order-card">
      <div class="order-top">
        <div>
          <h3>${escapeHTML(orderItemsText(order))}</h3>
          <p class="order-meta">
            Kode ${escapeHTML(order.code)}${order.isExample ? " (contoh)" : ""}, untuk ${formatVisitDate(order.date)}, ${visitorsText(order)}
            ${showBuyer ? `<br>Pemesan: ${escapeHTML(order.buyer.name)} (${escapeHTML(order.buyer.email)})` : ""}
          </p>
          ${statusTag(order)}
          ${order.status === "unpaid" && order.expiresAt ? `<p class="pay-countdown">Sisa waktu pembayaran: <strong data-countdown="${escapeHTML(order.expiresAt)}">--:--</strong></p>` : ""}
        </div>
        <div class="order-total">${formatIDR(orderTotal(order))}</div>
      </div>
      <div class="order-actions">${actions}</div>
    </article>`;
}

export function openPaymentDialog(order, methodName) {
  const dialog = document.querySelector("#payment-dialog");
  dialog.innerHTML = `
    <div class="dialog-inner">
      <h2 id="payment-title">Selesaikan pembayaran</h2>
      <p class="muted">Kode pesanan <strong>${escapeHTML(order.code)}</strong></p>
      <div class="summary-list" aria-label="Ringkasan pembayaran">
        <div class="summary-row"><span>Metode</span><span>${escapeHTML(methodName)}</span></div>
        ${order.expiresAt ? `<div class="summary-row"><span>Sisa waktu bayar</span><span data-countdown="${escapeHTML(order.expiresAt)}">--:--</span></div>` : ""}
        <div class="summary-row total"><span>Total bayar</span><span>${formatIDR(orderTotal(order))}</span></div>
      </div>
      <p class="small muted">Ini pembayaran contoh. Di versi produksi, langkah ini diteruskan ke penyedia pembayaran dan status pesanan berubah setelah pembayaran terverifikasi.</p>
      <div class="dialog-actions">
        <button class="btn btn-accent" type="button" data-action="confirm-payment" data-code="${order.code}">Bayar ${formatIDR(orderTotal(order))}</button>
        <button class="btn btn-outline" type="button" data-action="close-dialog">Nanti saja</button>
      </div>
    </div>`;
  dialog.showModal();
}

export function closePaymentDialog() {
  const dialog = document.querySelector("#payment-dialog");
  if (dialog.open) dialog.close();
}

let snapScriptPromise = null;
function loadSnap(clientKey) {
  if (window.snap) return Promise.resolve();
  if (!snapScriptPromise) {
    snapScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://app.sandbox.midtrans.com/snap/snap.js";
      script.setAttribute("data-client-key", clientKey);
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Gagal memuat jendela pembayaran Midtrans."));
      document.head.appendChild(script);
    });
  }
  return snapScriptPromise;
}

// Titik masuk pembayaran: pakai Midtrans sandbox bila server sudah diatur
// kuncinya, kalau belum jatuh ke dialog pembayaran contoh.
export async function openGatewayPayment(order, methodName) {
  let config = null;
  try {
    config = await fetchPaymentConfig();
  } catch {
    config = null;
  }
  if (!config?.enabled) {
    openPaymentDialog(order, methodName);
    return;
  }
  try {
    toast("Membuka jendela pembayaran Midtrans...");
    const { token } = await createPaymentToken(order.code);
    await loadSnap(config.clientKey);
    window.snap.pay(token, {
      onSuccess: async () => {
        try {
          await payOrder(order.code);
        } catch {
          // Webhook Midtrans akan menandai lunas begitu situs punya alamat publik
        }
        sessionStorage.setItem("tmii-success-once", order.code);
        window.location.href = `pembayaran-berhasil.html?kode=${order.code}`;
      },
      onPending: () => {
        toast("Pembayaran menunggu penyelesaian. Selesaikan sebelum batas waktunya ya.");
        window.location.href = ACCOUNTS_ENABLED ? "pesanan.html" : "cek-pesanan.html";
      },
      onError: () => {
        toast(`Pembayaran gagal di Midtrans. Pesanan tetap tersimpan, coba bayar lagi dari ${ACCOUNTS_ENABLED ? "Pesanan saya" : "Cek Pesanan"}.`, "error");
      },
      onClose: () => {
        toast(`Jendela pembayaran ditutup. Pesanan tersimpan di ${ACCOUNTS_ENABLED ? "Pesanan saya" : "Cek Pesanan"}, bisa dibayar kapan saja.`);
      },
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

// Confetti sekali saat pembayaran berhasil: perayaan momen pesanan lunas,
// memakai warna budaya yang sama dengan kategori wahana.
export function spawnConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#178a50", "#d98e00", "#ce4b1d", "#2f5da8", "#0b8585", "#7a4fa3"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 28; i += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 3600);
}
