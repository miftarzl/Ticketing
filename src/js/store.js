import { DEFAULT_VISIT_DATE, SERVICE_FEE, ticketById } from "./data.js";

// Keranjang dan sesi disimpan lokal di peramban.
// Akun dan pesanan disimpan di database SQLite lewat server (server.js).

const CART_KEY = "tmii-cart-v2";

// Fitur akun pengunjung (masuk/daftar/profil/pesanan saya) SEDANG
// DISEMBUNYIKAN atas keputusan Din (25 Nov): pembelian berjalan sebagai
// tamu seperti Ancol, dikenali dari data pemesan. Kodenya tidak dihapus;
// ubah nilai ini ke true untuk menampilkan lagi seluruh UI akun.
export const ACCOUNTS_ENABLED = false;

// Kontak tamu (nomor WhatsApp pemesan) diingat selama sesi browser ini
// supaya halaman sukses dan e-tiket bisa membuka pesanan tamu tanpa akun,
// dengan kredensial yang sama seperti halaman Cek Pesanan.
const GUEST_CONTACT_KEY = "tmii-guest-contact";
export function guestContact() {
  try {
    return sessionStorage.getItem(GUEST_CONTACT_KEY) || "";
  } catch {
    return "";
  }
}
export function rememberGuestContact(whatsapp) {
  try {
    if (whatsapp) sessionStorage.setItem(GUEST_CONTACT_KEY, String(whatsapp));
  } catch {
    // Abaikan: penyimpanan sesi tidak selalu tersedia.
  }
}
const SESSION_KEYS = {
  site: "tmii-session-v2",
  admin: "tmii-admin-session-v1",
};

// ---------- Keranjang (lokal) ----------
const defaultCart = () => ({
  date: DEFAULT_VISIT_DATE,
  adults: 1,
  children: 0,
  category: "semua",
  items: {},
});

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY));
    if (!saved || typeof saved !== "object") return defaultCart();
    // Jumlah pengunjung TIDAK PERNAH diwarisi dari simpanan: setiap halaman
    // dibuka, rombongan mulai dari 1 dewasa + 0 anak dan hanya berubah bila
    // pembeli sendiri mengaturnya di halaman pemesanan.
    return { ...defaultCart(), ...saved, adults: 1, children: 0 };
  } catch {
    return defaultCart();
  }
}

let cart = loadCart();

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function getCart() {
  return cart;
}

export function setCart(patch) {
  cart = { ...cart, ...patch };
  saveCart();
}

export function cartEntries() {
  return Object.entries(cart.items)
    .map(([id, qty]) => ({ ticket: ticketById(id), qty }))
    .filter((entry) => entry.ticket && entry.qty > 0);
}

export function cartCount() {
  return cartEntries().reduce((sum, entry) => sum + entry.qty, 0);
}

export function visitorCount() {
  return (Number(cart.adults) || 0) + (Number(cart.children) || 0);
}

// Harga tiket per orang dikali jumlah pengunjung; harga paket tetap per paket.
export function cartSubtotal() {
  return cartEntries().reduce(
    (sum, entry) => sum + entry.ticket.price * (entry.ticket.perPerson ? visitorCount() : entry.qty),
    0,
  );
}

export function addTicketToCart(ticketId) {
  const ticket = ticketById(ticketId);
  if (!ticket) return;
  // Tiket per orang cukup ditandai sekali: berlakunya untuk semua pengunjung,
  // jadi jumlahnya tidak dihitung dari klik melainkan dari jumlah pengunjung.
  // Paket bertambah 1 per klik; jumlah paket diatur lagi di halaman pemesanan.
  if (ticket.perPerson) cart.items[ticketId] = 1;
  else cart.items[ticketId] = (cart.items[ticketId] || 0) + 1;
  saveCart();
}

export function removeTicketFromCart(ticketId) {
  delete cart.items[ticketId];
  saveCart();
}

export function setCartItemQty(ticketId, qty) {
  if (qty <= 0) delete cart.items[ticketId];
  else cart.items[ticketId] = qty;
  saveCart();
}

export function clearCart() {
  cart.items = {};
  // Jumlah pengunjung juga dikembalikan ke awal (1 dewasa, 0 anak) supaya
  // pesanan berikutnya tidak mewarisi rombongan pesanan sebelumnya.
  cart.adults = 1;
  cart.children = 0;
  saveCart();
}

// ---------- Sesi (lokal, token dari server) ----------
// Sesi situs dan sesi panel admin disimpan di tempat TERPISAH, jadi masuk
// sebagai admin tidak menggeser sesi pengguna, dan sebaliknya.
let sessionArea = "site";

export function setSessionArea(area) {
  sessionArea = area === "admin" ? "admin" : "site";
  session = loadSession();
}

function sessionKey() {
  return SESSION_KEYS[sessionArea];
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey())) || null;
  } catch {
    return null;
  }
}

let session = loadSession();

function saveSession() {
  if (session) localStorage.setItem(sessionKey(), JSON.stringify(session));
  else localStorage.removeItem(sessionKey());
}

export function currentUser() {
  return session?.user || null;
}

export function authToken() {
  return session?.token || "";
}

export function endSession() {
  const token = authToken();
  session = null;
  saveSession();
  if (token) {
    fetch("/api/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

// ---------- API ----------
export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Server belum jalan. Jalankan node server.js dulu, lalu buka http://localhost:3000");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}

export async function registerAccount({ name, email, whatsapp, passwordHash }) {
  const data = await api("/api/register", {
    method: "POST",
    body: { name, email, whatsapp, passwordHash },
  });
  session = { token: data.token, user: data.user, permissions: data.user.permissions || [] };
  saveSession();
  return data.user;
}

export async function loginAccount({ email, passwordHash }) {
  const data = await api("/api/login", {
    method: "POST",
    body: { email, passwordHash },
  });
  session = { token: data.token, user: data.user, permissions: data.user.permissions || [] };
  saveSession();
  return data.user;
}

// Segarkan data pengguna di sesi dari server (misalnya sesudah ganti
// sandi, penanda wajib ganti sandi harus hilang dari sesi setempat).
export async function refreshSessionUser() {
  if (!authToken()) return null;
  const data = await api("/api/me");
  if (session && data.user) {
    session = { ...session, user: data.user, permissions: data.user.permissions || [] };
    saveSession();
  }
  return session?.user || null;
}

export function currentPermissions() {
  return session?.permissions || session?.user?.permissions || [];
}

export function hasPermission(perm) {
  return currentPermissions().includes(perm);
}

// ---------- Pesanan (database) ----------
export function orderSubtotal(order) {
  return order.items.reduce((sum, item) => {
    const ticket = ticketById(item.id);
    return sum + (ticket ? ticket.price * item.qty : 0);
  }, 0);
}

export function orderTotal(order) {
  return orderSubtotal(order) + Number(order.serviceFee ?? SERVICE_FEE);
}

export async function fetchMyOrders() {
  const data = await api("/api/orders");
  return data.orders;
}

export async function createOrder({ buyer, paymentMethod, date }) {
  const data = await api("/api/orders", {
    method: "POST",
    body: {
      date: date || cart.date,
      adults: cart.adults,
      children: cart.children,
      // Di pesanan, jumlah tiket per orang dicatat sebanyak jumlah pengunjung,
      // supaya total harga pesanan konsisten di semua tempat (situs, email, PDF).
      items: cartEntries().map((entry) => ({
        id: entry.ticket.id,
        qty: entry.ticket.perPerson ? Math.max(1, visitorCount()) : entry.qty,
      })),
      buyer,
      paymentMethod,
    },
  });
  rememberGuestContact(buyer?.whatsapp);
  return data.order;
}

export async function fetchOrder(code, contact = "") {
  const query = contact ? `?contact=${encodeURIComponent(contact)}` : "";
  const data = await api(`/api/orders/${encodeURIComponent(code)}${query}`);
  return data.order;
}

export async function resendTicketEmail(code) {
  const data = await api(`/api/orders/${encodeURIComponent(code)}/resend-email`, { method: "POST", body: { contact: guestContact() } });
  return data.order;
}

export async function payOrder(code) {
  const data = await api(`/api/orders/${encodeURIComponent(code)}/pay`, { method: "POST", body: { contact: guestContact() } });
  return data.order;
}

export async function fetchPaymentConfig() {
  const data = await api("/api/config");
  return data.payments;
}

export async function createPaymentToken(code) {
  const data = await api(`/api/orders/${encodeURIComponent(code)}/payment-token`, { method: "POST", body: { contact: guestContact() } });
  return data;
}

export async function cancelOrderByCode(code) {
  const data = await api(`/api/orders/${encodeURIComponent(code)}/cancel`, { method: "POST", body: { contact: guestContact() } });
  return data.order;
}

export async function fetchRotatingQr(code) {
  const contact = guestContact();
  const query = contact ? `?contact=${encodeURIComponent(contact)}` : "";
  return api(`/api/orders/${encodeURIComponent(code)}/qr${query}`);
}

export async function validateTicket(body) {
  return api("/api/tickets/validate", { method: "POST", body });
}

export async function fetchScanLogs() {
  const data = await api("/api/admin/scan-logs");
  return data.logs;
}
