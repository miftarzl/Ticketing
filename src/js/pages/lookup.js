import { orderCard } from "../components.js";
import { fetchOrder, rememberGuestContact } from "../store.js";
import { setFieldError, validateEmail, validateWhatsApp } from "../utils.js";

export function renderLookup() {
  return `
  <div class="container">
    <div class="page-head">
      <h1>Cek Pesanan</h1>
      <p>Masukkan kode pesanan dan nomor WhatsApp atau email yang dipakai saat memesan.</p>
    </div>
    <div class="two-column">
      <form class="card card-pad" id="lookup-form" novalidate>
        <div class="field">
          <label for="lookup-code">Kode pesanan</label>
          <input id="lookup-code" name="code" type="text" placeholder="Contoh TMII-2026-0000" autocomplete="off" required>
        </div>
        <div class="field">
          <label for="lookup-contact">WhatsApp atau email pemesan</label>
          <input id="lookup-contact" name="contact" type="text" placeholder="08xxxxxxxxxx atau nama@email.com" autocomplete="email" required>
        </div>
        <button class="btn btn-primary" type="submit">Cari pesanan</button>
      </form>
      <section id="lookup-result" aria-live="polite">
        <div class="card empty-state">
          <h3>Belum ada pencarian</h3>
          <p>Hasil pencarian akan tampil di sini. Untuk contoh, gunakan kode TMII-2026-0000 dengan kontak nama@email.com.</p>
        </div>
      </section>
    </div>
  </div>`;
}

export function mountLookup() {
  const form = document.querySelector("#lookup-form");
  const result = document.querySelector("#lookup-result");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const codeInput = form.elements.code;
    const contactInput = form.elements.contact;
    const code = codeInput.value.trim().toUpperCase();
    const contact = contactInput.value.trim().toLowerCase();
    let valid = true;

    if (!/^TMII-\d{4}-\d{4}$/.test(code)) {
      setFieldError(codeInput, "Kode pesanan formatnya TMII-2026-0000.");
      valid = false;
    } else setFieldError(codeInput, "");

    if (!validateEmail(contact) && !validateWhatsApp(contact)) {
      setFieldError(contactInput, "Isi nomor WhatsApp atau email yang dipakai saat memesan.");
      valid = false;
    } else setFieldError(contactInput, "");
    if (!valid) return;

    result.innerHTML = `
      <div class="card card-pad" role="status">
        <h3>Sedang memuat</h3>
        <p class="muted">Kami sedang mengambil pesanan kamu dari database.</p>
        <div class="skeleton" aria-hidden="true"><div></div><div></div><div></div></div>
      </div>`;

    try {
      const order = await fetchOrder(code, contact);
      // Ingat kontak yang terbukti cocok ini, supaya tombol kirim ulang
      // e-tiket pada hasil pencarian diakui server sebagai pemilik pesanan.
      rememberGuestContact(contact);
      result.innerHTML = orderCard(order, { showBuyer: true });
    } catch {
      result.innerHTML = `
        <div class="card empty-state" role="alert">
          <h3>Pesanan tidak ditemukan</h3>
          <p>Kode atau kontak ini tidak cocok dengan pesanan mana pun. Periksa ejaan kode di e-tiket kamu, lalu coba lagi.</p>
          <button class="btn btn-primary" type="button" onclick="document.querySelector('#lookup-code').focus()">Coba kode lain</button>
        </div>`;
    }
  });
}
