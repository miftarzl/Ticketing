import { orderCard } from "../components.js";
import { currentUser, endSession, fetchMyOrders, loginAccount, registerAccount } from "../store.js";
import { escapeHTML, qs, sha256, toast, validateEmail, validateWhatsApp } from "../utils.js";

export function mountLogin() {
  qs("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    if (!validateEmail(email)) {
      toast("Periksa lagi alamat emailnya.", "error");
      form.querySelector("#login-email").focus();
      return;
    }
    if (!password) {
      toast("Kata sandi belum diisi.", "error");
      return;
    }
    try {
      const user = await loginAccount({ email, passwordHash: await sha256(password) });
      if (user.role !== "user") {
        // Akun pengelola tidak masuk lewat halaman pengguna
        endSession();
        toast("Akun ini tidak bisa masuk dari halaman ini.", "error");
        return;
      }
      toast(`Selamat datang kembali, ${user.name.split(" ")[0]}.`);
      window.location.href = "pesanan.html";
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

export function mountRegister() {
  qs("#register-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const whatsapp = String(data.get("whatsapp") || "").trim();
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");

    if (name.length < 2) {
      toast("Nama lengkap perlu diisi.", "error");
      return;
    }
    if (!validateEmail(email)) {
      toast("Periksa lagi alamat emailnya.", "error");
      return;
    }
    if (!validateWhatsApp(whatsapp)) {
      toast("Nomor WhatsApp perlu diawali 08 dan berisi nomor yang benar.", "error");
      return;
    }
    if (password.length < 8) {
      toast("Kata sandi minimal 8 karakter.", "error");
      return;
    }
    if (password !== confirm) {
      toast("Pengulangan kata sandi belum sama.", "error");
      return;
    }
    try {
      await registerAccount({ name, email, whatsapp, passwordHash: await sha256(password) });
      toast("Akun berhasil dibuat dan tersimpan di database.");
      window.location.href = "pesanan.html";
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

export function renderProfile() {
  const user = currentUser();
  return `
    <div class="container">
      <div class="page-head"><h1>Profil saya</h1></div>
      <div class="profile-grid">
        <aside class="card card-pad profile-summary">
          <span class="avatar" aria-hidden="true">${escapeHTML(user.name.trim().charAt(0).toUpperCase())}</span>
          <h2>${escapeHTML(user.name)}</h2>
          <p class="muted">${escapeHTML(user.email)}</p>
          <div class="profile-links">
            <a href="pesanan.html">Pesanan saya</a>
            <button type="button" data-action="logout">Keluar</button>
          </div>
        </aside>
        <section class="card card-pad" aria-labelledby="profile-detail">
          <h2 id="profile-detail">Data akun</h2>
          <dl class="profile-list">
            <div><dt>Nama lengkap</dt><dd>${escapeHTML(user.name)}</dd></div>
            <div><dt>Email</dt><dd>${escapeHTML(user.email)}</dd></div>
            <div><dt>Nomor WhatsApp</dt><dd>${escapeHTML(user.whatsapp)}</dd></div>
          </dl>
          <p class="small muted">Akun tersimpan di database server (SQLite). Edit profil belum tersedia di mockup ini.</p>
        </section>
      </div>
    </div>`;
}

let ordersFilter = "all";
let cachedOrders = null;

export function renderOrdersPage(orders) {
  const user = currentUser();
  const filtered =
    ordersFilter === "unpaid"
      ? orders.filter((order) => order.status === "unpaid")
      : ordersFilter === "done"
        ? orders.filter((order) => order.status === "paid")
        : orders;

  const cards = filtered.length
    ? filtered.map((order) => orderCard(order)).join("")
    : `<div class="card empty-state">
        <h3>Belum ada pesanan di daftar ini</h3>
        <p>Pesanan yang cocok dengan pilihan ini akan muncul di sini.</p>
        <a class="btn btn-accent" href="tiket.html">Pesan tiket</a>
      </div>`;

  const tab = (value, label) =>
    `<button type="button" data-filter="${value}" aria-selected="${ordersFilter === value}">${label}</button>`;

  return `
    <div class="container">
      <div class="page-head">
        <h1>Pesanan saya</h1>
        <p>Hai, ${escapeHTML(user.name.split(" ")[0])}. Pesanan yang belum selesai dan yang sudah selesai dipisah supaya mudah dicek. E-tiket ada di pesanan yang sudah dibayar, jadi tidak ada menu e-tiket terpisah.</p>
      </div>
      <div class="tabs" role="tablist" aria-label="Saring pesanan">
        ${tab("all", "Semua")}
        ${tab("unpaid", "Belum selesai")}
        ${tab("done", "Selesai")}
      </div>
      <div>${cards}</div>
    </div>`;
}

export async function loadOrdersPage(root) {
  root.innerHTML = `
    <div class="container">
      <div class="page-head"><h1>Pesanan saya</h1></div>
      <div class="card card-pad" role="status">
        <h3>Sedang memuat</h3>
        <p class="muted">Mengambil pesanan kamu dari database.</p>
        <div class="skeleton" aria-hidden="true"><div></div><div></div><div></div></div>
      </div>
    </div>`;
  try {
    cachedOrders = await fetchMyOrders();
    root.innerHTML = renderOrdersPage(cachedOrders);
  } catch (error) {
    root.innerHTML = `
      <div class="container">
        <div class="page-head"><h1>Pesanan saya</h1></div>
        <div class="card empty-state">
          <h3>Pesanan belum bisa dimuat</h3>
          <p>${escapeHTML(error.message)}</p>
        </div>
      </div>`;
  }
}

export function mountOrdersPage(root) {
  root.addEventListener("click", (event) => {
    const filterButton = event.target.closest("[data-filter]");
    if (filterButton && cachedOrders) {
      ordersFilter = filterButton.dataset.filter;
      root.innerHTML = renderOrdersPage(cachedOrders);
    }
  });
  document.addEventListener("orders-changed", () => loadOrdersPage(root));
}

export function requireUser() {
  if (currentUser()) return true;
  toast("Masuk dulu untuk membuka halaman ini.", "error");
  window.location.href = "masuk.html";
  return false;
}
