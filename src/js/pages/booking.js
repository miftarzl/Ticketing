import { openGatewayPayment } from "../components.js";
import { SERVICE_FEE, ticketById } from "../data.js";
import {
  ACCOUNTS_ENABLED,
  cartEntries,
  cartSubtotal,
  createOrder,
  currentUser,
  getCart,
  setCart,
  setCartItemQty,
  visitorCount,
} from "../store.js";
import {
  escapeHTML,
  formatIDR,
  formatVisitDate,
  qs,
  toast,
  validateEmail,
  validateWhatsApp,
  visitorsText,
} from "../utils.js";

// Kapasitas Paket Paspor Keluarga di keranjang (null bila tidak ada paket).
function packageCapacity() {
  const pkg = cartEntries().find((entry) => entry.ticket.category === "paket");
  if (!pkg) return null;
  return {
    qty: pkg.qty,
    adults: (pkg.ticket.capacityAdults || 0) * pkg.qty,
    children: (pkg.ticket.capacityChildren || 0) * pkg.qty,
  };
}

function visitorNoteText() {
  return "Jumlah ini berlaku untuk semua tiket di pesanan ini. Jumlah inilah yang tertulis di e-tiket dan jadi dasar petugas mengizinkan masuk, jadi pastikan sesuai rombonganmu.";
}

const countOptions = (selected, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const value = from + i;
    return `<option value="${value}"${value === selected ? " selected" : ""}>${value} orang</option>`;
  }).join("");

// Bagian Pengunjung hanya tampil untuk pesanan TANPA paket. Rombongan
// paket sudah ditentukan isi paketnya sendiri (2 dewasa + 2 anak per
// paket), jadi menampilkannya untuk pesanan paket cuma membingungkan.
function visitorsSectionHTML(cart) {
  if (packageCapacity()) return "";
  return `
            <section class="card card-pad" aria-labelledby="visitors-title">
              <h2 id="visitors-title">Pengunjung</h2>
              <div class="field-row">
                <div class="field">
                  <label for="visitor-adults">Dewasa</label>
                  <select id="visitor-adults" name="adults">${countOptions(cart.adults, 1, 10)}</select>
                </div>
                <div class="field">
                  <label for="visitor-children">Anak</label>
                  <select id="visitor-children" name="children">${countOptions(cart.children, 0, 10)}</select>
                </div>
              </div>
              <p id="visitor-note" class="small muted">${escapeHTML(visitorNoteText())}</p>
            </section>`;
}

// Label jumlah pengunjung: untuk pesanan paket dihitung dari isi paket.
function visitorsLabelText() {
  const cap = packageCapacity();
  if (cap) return `${cap.adults} dewasa, ${cap.children} anak`;
  return visitorsText(getCart());
}

function checkoutItemsHTML() {
  const entries = cartEntries();
  if (!entries.length)
    return `<p class="muted">Keranjang masih kosong. <a href="tiket.html">Pilih tiket dulu</a>.</p>`;
  const visitors = visitorCount();
  return entries
    .map(({ ticket, qty }) => {
      if (ticket.perPerson)
        return `
        <div class="checkout-item">
          <div><strong>${escapeHTML(ticket.name)}</strong><span>${formatIDR(ticket.price)} per orang x ${visitors} pengunjung</span></div>
          <button class="btn btn-ghost" type="button" data-action="remove-item" data-id="${ticket.id}">Hapus</button>
          <strong>${formatIDR(ticket.price * visitors)}</strong>
        </div>`;
      return `
        <div class="checkout-item">
          <div><strong>${escapeHTML(ticket.name)}</strong><span>${formatIDR(ticket.price)} per ${escapeHTML(ticket.unit)}</span></div>
          <div class="qty-control">
            <button type="button" data-action="qty-minus" data-id="${ticket.id}" aria-label="Kurangi ${escapeHTML(ticket.name)}">-</button>
            <output aria-label="Jumlah ${escapeHTML(ticket.name)}">${qty}</output>
            <button type="button" data-action="qty-plus" data-id="${ticket.id}" aria-label="Tambah ${escapeHTML(ticket.name)}">+</button>
          </div>
          <strong>${formatIDR(ticket.price * qty)}</strong>
        </div>`;
    })
    .join("");
}

function summaryListHTML() {
  const cart = getCart();
  const entries = cartEntries();
  const subtotal = cartSubtotal();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const visitDate = cart.date && cart.date >= today ? cart.date : today;
  return `
              <div class="summary-row"><span>Tanggal kunjungan</span><span id="summary-visit-date">${formatVisitDate(visitDate)}</span></div>
              <div class="summary-row"><span>Pengunjung</span><span data-visitors-label>${escapeHTML(visitorsLabelText())}</span></div>
              <div class="summary-row"><span>Subtotal tiket</span><span>${formatIDR(subtotal)}</span></div>
              <div class="summary-row"><span>Biaya layanan</span><span>${formatIDR(entries.length ? SERVICE_FEE : 0)}</span></div>
              <div class="summary-row total"><span>Total bayar</span><span>${formatIDR(entries.length ? subtotal + SERVICE_FEE : 0)}</span></div>`;
}

export function renderCheckoutPage() {
  const cart = getCart();
  const entries = cartEntries();
  const user = currentUser();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const visitDate = cart.date && cart.date >= today ? cart.date : today;
  const items = checkoutItemsHTML();

  return `
    <div class="container">
      <div class="page-head">
        <h1>Data pemesanan</h1>
        <p><span data-visitors-label>${escapeHTML(visitorsLabelText())}</span>. ${packageCapacity() ? "Jumlah pengunjung mengikuti isi Paket Paspor Keluarga; tanggal kunjungan dipilih di formulir bawah ini." : "Tanggal kunjungan dan jumlah pengunjung dipilih di formulir bawah ini."} <span class="example-note">Harga contoh untuk mockup, bukan harga resmi TMII.</span></p>
      </div>
      <form id="checkout-form" novalidate>
        <div class="two-column">
          <div class="checkout-stack">
            <section class="card card-pad" aria-labelledby="tickets-chosen">
              <h2 id="tickets-chosen">Tiket yang dipilih</h2>
              <div class="checkout-items">${items}</div>
            </section>
            <section class="card card-pad" aria-labelledby="visit-date-title">
              <h2 id="visit-date-title">Tanggal kunjungan</h2>
              <div class="field">
                <label for="visit-date">Pilih tanggal kunjungan</label>
                <input id="visit-date" name="date" type="date" value="${visitDate}" min="${today}" required>
                <span class="hint">E-tiket hanya berlaku pada tanggal yang dipilih ini, jadi pastikan sudah benar sebelum membayar.</span>
              </div>
            </section>
            ${visitorsSectionHTML(cart)}
            <section class="card card-pad" aria-labelledby="buyer-data">
              <h2 id="buyer-data">Data pemesan</h2>
              <p class="small muted">Setelah pembayaran lunas, e-tiket dikirim ke email di bawah ini dan bisa diunduh sebagai PDF.</p>
              <div class="field">
                <label for="buyer-name">Nama pemesan</label>
                <input id="buyer-name" name="name" type="text" autocomplete="name" placeholder="Tulis nama pemesan" value="${escapeHTML(user?.name || "")}" required>
              </div>
              <div class="field">
                <label for="buyer-whatsapp">Nomor WhatsApp</label>
                <input id="buyer-whatsapp" name="whatsapp" type="tel" autocomplete="tel" placeholder="Nomor aktif, format 08xxxxxxxxxx" value="${escapeHTML(user?.whatsapp || "")}" required>
                <span class="hint">Dipakai petugas untuk menghubungimu soal kunjungan bila perlu.</span>
              </div>
              <div class="field">
                <label for="buyer-email">Email</label>
                <input id="buyer-email" name="email" type="email" autocomplete="email" placeholder="nama@email.com" value="${escapeHTML(user?.email || "")}" required>
                <span class="hint">E-tiket berisi kode QR dikirim ke email ini setelah pembayaran lunas.</span>
              </div>
            </section>
          </div>
          <aside class="card card-pad" aria-labelledby="summary-title">
            <h2 id="summary-title">Ringkasan</h2>
            <div class="summary-list">${summaryListHTML()}
            </div>
            <p><button id="checkout-submit" class="btn btn-accent btn-block" type="submit" ${entries.length ? "" : "disabled"}>Bayar sekarang</button></p>
            <p class="small muted">Dengan menekan Bayar sekarang, pesanan dibuat lalu jendela pembayaran dibuka: Midtrans sandbox bila kunci gateway sudah diatur di server, atau pembayaran contoh bila belum. ${ACCOUNTS_ENABLED ? "Pesanan yang belum dibayar tetap tersimpan di Pesanan saya kalau kamu masuk." : "Simpan kode pesananmu: pesanan yang belum dibayar bisa dilacak dan dibayar lagi lewat Cek Pesanan dengan kode + nomor WhatsApp pemesan."}</p>
          </aside>
        </div>
      </form>
    </div>`;
}

export function mountCheckout(root) {
  // Perbarui daftar tiket, ringkasan, dan catatan pengunjung di tempat,
  // tanpa menggambar ulang seluruh halaman (isian data pemesan aman).
  const refreshParts = () => {
    // Paket masuk atau keluar keranjang mengubah tampil/tidaknya bagian
    // Pengunjung, jadi khusus perpindahan itu halaman digambar ulang.
    const sectionVisible = Boolean(root.querySelector("#visitor-adults"));
    if (sectionVisible === Boolean(packageCapacity())) {
      root.innerHTML = renderCheckoutPage();
      return;
    }
    const itemsBox = root.querySelector(".checkout-items");
    if (itemsBox) itemsBox.innerHTML = checkoutItemsHTML();
    const summaryBox = root.querySelector(".summary-list");
    if (summaryBox) summaryBox.innerHTML = summaryListHTML();
    const submit = root.querySelector("#checkout-submit");
    if (submit) submit.disabled = !cartEntries().length;
    const text = visitorsLabelText();
    root.querySelectorAll("[data-visitors-label]").forEach((el) => {
      el.textContent = text;
    });
  };

  root.addEventListener("click", (event) => {
    const removeButton = event.target.closest('[data-action="remove-item"]');
    if (removeButton) {
      setCartItemQty(removeButton.dataset.id, 0);
      refreshParts();
      return;
    }
    const qtyButton = event.target.closest('[data-action="qty-plus"], [data-action="qty-minus"]');
    if (!qtyButton) return;
    const entry = cartEntries().find((item) => item.ticket.id === qtyButton.dataset.id);
    if (!entry) return;
    const delta = qtyButton.dataset.action === "qty-plus" ? 1 : -1;
    setCartItemQty(entry.ticket.id, entry.qty + delta);
    refreshParts();
  });

  root.addEventListener("change", (event) => {
    if (event.target.id === "visitor-adults" || event.target.id === "visitor-children") {
      setCart({
        adults: Number(qs("#visitor-adults")?.value || 1),
        children: Number(qs("#visitor-children")?.value || 0),
      });
      refreshParts();
      return;
    }
    if (event.target.id !== "visit-date") return;
    setCart({ date: event.target.value });
    const label = qs("#summary-visit-date");
    if (label) label.textContent = formatVisitDate(event.target.value);
  });

  root.addEventListener("submit", async (event) => {
    if (event.target.id !== "checkout-form") return;
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const date = String(data.get("date") || "").trim();
    const name = String(data.get("name") || "").trim();
    const whatsapp = String(data.get("whatsapp") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const paymentMethod = "midtrans";

    if (!cartEntries().length) {
      toast("Keranjang masih kosong.", "error");
      return;
    }
    if (!date) {
      toast("Tanggal kunjungan perlu dipilih.", "error");
      form.querySelector("#visit-date").focus();
      return;
    }
    if (name.length < 2) {
      toast("Nama pemesan perlu diisi.", "error");
      form.querySelector("#buyer-name").focus();
      return;
    }
    if (!validateWhatsApp(whatsapp)) {
      toast("Nomor WhatsApp perlu diawali 08 dan berisi nomor yang benar.", "error");
      form.querySelector("#buyer-whatsapp").focus();
      return;
    }
    if (!validateEmail(email)) {
      toast("Periksa lagi alamat emailnya.", "error");
      form.querySelector("#buyer-email").focus();
      return;
    }
    try {
      // Untuk pesanan paket, rombongan mengikuti isi paket (2 dewasa +
      // 2 anak per paket) karena menu Pengunjung disembunyikan; selain
      // itu jumlah pengunjung dibaca dari menu Pengunjung.
      const cap = packageCapacity();
      const adults = cap ? cap.adults : Number(data.get("adults") || 0);
      const children = cap ? cap.children : Number(data.get("children") || 0);
      if (!cap && adults < 1) {
        toast("Minimal ada 1 pengunjung dewasa ya.", "error");
        form.querySelector("#visitor-adults")?.focus();
        return;
      }
      setCart({ date, adults, children });
      const order = await createOrder({ buyer: { name, whatsapp, email }, paymentMethod, date });
      toast("Pesanan dibuat dan tersimpan di database. Selesaikan pembayaran untuk menerima e-tiket.");
      openGatewayPayment(order, "Midtrans");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

export function renderPaymentSuccess(order) {
  if (!order) {
    return `
      <div class="container">
        <div class="success-wrap">
          <h1>Pesanan tidak ditemukan</h1>
          <p class="muted">Kode pesanan di alamat ini tidak cocok dengan data di peramban ini.</p>
          <p><a class="btn btn-primary" href="index.html">Kembali ke beranda</a></p>
        </div>
      </div>`;
  }
  return `
    <div class="container">
      <div class="success-wrap">
        <div class="success-mark" aria-hidden="true">✓</div>
        <h1>Pembayaran berhasil</h1>
        <p>Terima kasih, ${escapeHTML(order.buyer.name.split(" ")[0])}. Pesanan <strong>${escapeHTML(order.code)}</strong> sudah dibayar.</p>
        <div class="card card-pad success-card">
          <div class="alert alert-info" role="status">
            <strong>E-tiketmu ada di email, dan bisa juga diunduh sebagai PDF.</strong><br>
            Salinan e-tiket berisi kode QR dan kode pindai sudah dikirim ke kotak masuk ${escapeHTML(order.buyer.email)}. Versi PDF-nya bisa kamu unduh lewat tombol Unduh PDF di bawah, atau dibuka lagi kapan saja dari menu Pesanan Saya.
          </div>
          <div class="summary-list">
            <div class="summary-row"><span>Tiket</span><span>${order.items.map((item) => `${item.qty} x ${escapeHTML(ticketById(item.id)?.name || item.id)}`).join(", ")}</span></div>
            <div class="summary-row"><span>Tanggal kunjungan</span><span>${formatVisitDate(order.date)}</span></div>
            <div class="summary-row"><span>Status kirim email</span><span>${escapeHTML(order.emailStatus)}</span></div>
          </div>
        </div>
        <div class="success-actions">
          <a class="btn btn-primary" href="e-tiket.html?kode=${order.code}">Lihat e-tiket</a>
          <button class="btn btn-outline" type="button" data-action="download-pdf" data-code="${order.code}">Unduh PDF</button>
          <button class="btn btn-ghost" type="button" data-action="resend-email" data-code="${order.code}">Kirim ulang ke email</button>
        </div>
        <p class="small muted">Belum menerima emailnya? Periksa folder spam dulu, lalu pakai tombol Kirim ulang ke email di atas.</p>
      </div>
    </div>`;
}
