import { TICKETS, ticketById } from "../data.js";
import { ACCOUNTS_ENABLED, cartEntries, cartSubtotal, currentUser, getCart } from "../store.js";
import { escapeHTML, formatIDR, qs, visitorsText } from "../utils.js";

// Gerbang masuk hanya berlaku selama fitur akun ditampilkan; dalam mode
// tamu katalog terbuka untuk semua pengunjung (pola Ancol).
if (ACCOUNTS_ENABLED && !currentUser()) {
  sessionStorage.setItem("tmii-login-notice", "1");
  window.location.replace("masuk.html");
  throw new Error("Mengalihkan ke halaman masuk");
}

const qtyOf = (id) => cartEntries().find((entry) => entry.ticket.id === id)?.qty || 0;

const CATEGORY_LABELS = {
  paket: "Paket",
  wajib: "Tiket wajib",
  budaya: "Budaya",
  wahana: "Wahana",
};

function actionButton(ticket) {
  const qty = qtyOf(ticket.id);
  if (qty > 0)
    return `<button class="btn btn-outline" type="button" data-action="remove-ticket" data-id="${ticket.id}">Hapus dari pesanan</button>`;
  return `<button class="btn btn-primary" type="button" data-action="add-ticket" data-id="${ticket.id}">Tambah tiket ini</button>`;
}

function renderCatalog() {
  const cart = getCart();
  const flagship = TICKETS.find((ticket) => ticket.layout === "flagship");
  const large = TICKETS.filter((ticket) => ["large", "side"].includes(ticket.layout));
  const rows = TICKETS.filter((ticket) => ticket.layout === "row");

  qs("#catalog").innerHTML = `
    <p class="muted catalog-note">${escapeHTML(visitorsText(cart))}. Tiket per orang berlaku untuk semua pengunjung di rombonganmu, jadi harganya dihitung per pengunjung; jumlah pengunjung dan tanggal kunjungan diatur di halaman pemesanan. Paket Paspor Keluarga berisi semua tiket, jadi tidak bisa dicampur tiket lain.</p>
    <article class="ticket-flagship cat-kunyit">
      <img class="flagship-img" src="${flagship.image}" alt="${escapeHTML(flagship.imageAlt)}" width="${flagship.width}" height="${flagship.height}" loading="lazy">
      <div>
        <span class="cat-chip">Paket</span>
        <h2>${escapeHTML(flagship.name)}</h2>
        <p>${escapeHTML(flagship.description)}</p>
        ${qtyOf(flagship.id)
          ? `<button class="btn btn-light" type="button" data-action="remove-ticket" data-id="${flagship.id}">Hapus dari pesanan</button>`
          : `<button class="btn btn-accent" type="button" data-action="add-ticket" data-id="${flagship.id}">Tambah paket ini</button>`}
      </div>
      <div class="flagship-side">
        <p class="price">${formatIDR(flagship.price)}</p>
        <p>per ${escapeHTML(flagship.unit)}</p>
      </div>
    </article>
    <div class="ticket-grid">
      ${large
        .map(
          (ticket) => `
        <article class="card ticket-card cat-${ticket.color || "daun"} ${ticket.layout === "side" ? "sand" : ""}">
          <img class="ticket-img" src="${ticket.image}" alt="${escapeHTML(ticket.imageAlt)}" width="${ticket.width}" height="${ticket.height}" loading="lazy">
          <span class="cat-chip">${CATEGORY_LABELS[ticket.category] || "Tiket"}</span>
          <h3>${escapeHTML(ticket.name)}</h3>
          <p>${escapeHTML(ticket.description)}</p>
          <div class="card-foot">
            <span class="price">${formatIDR(ticket.price)} <span class="small muted">per ${escapeHTML(ticket.unit)}</span></span>
            ${actionButton(ticket)}
          </div>
        </article>`
        )
        .join("")}
    </div>
    <div class="ticket-rows">
      ${rows
        .map(
          (ticket) => `
        <article class="card ticket-row cat-${ticket.color || "daun"}">
          <img class="ticket-thumb" src="${ticket.image}" alt="${escapeHTML(ticket.imageAlt)}" width="${ticket.width}" height="${ticket.height}" loading="lazy">
          <div>
            <span class="cat-chip">${CATEGORY_LABELS[ticket.category] || "Tiket"}</span>
            <h3>${escapeHTML(ticket.name)}</h3>
            <p>${escapeHTML(ticket.description)}</p>
          </div>
          <span class="price">${formatIDR(ticket.price)} <span class="small muted">per ${escapeHTML(ticket.unit)}</span></span>
          ${actionButton(ticket)}
        </article>`
        )
        .join("")}
    </div>`;
  renderDock();
}

function renderDock() {
  const dock = qs("#cart-dock");
  if (!dock) return;
  const kinds = cartEntries().length;
  if (!kinds) {
    dock.innerHTML = "";
    return;
  }
  dock.innerHTML = `
    <div class="cart-dock" role="region" aria-label="Ringkasan pesanan">
      <div><strong>${kinds} jenis tiket dipilih</strong><span>Total sementara ${formatIDR(cartSubtotal())}, belum termasuk biaya layanan.</span></div>
      <a class="btn btn-accent" href="pemesanan.html">Lanjut ke data pemesanan</a>
    </div>`;
}

renderCatalog();
document.addEventListener("cart-changed", renderCatalog);
