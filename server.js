import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SERVICE_FEE, TICKETS, ticketById } from "./src/js/data.js";
import { mailConfig, mailConfigured, sendPlainEmail, sendTicketEmail } from "./src/server/mail.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);

// ---------- Payment gateway: Midtrans sandbox ----------
// Kunci dibaca dari environment saat server dijalankan; bila tidak ada,
// dari berkas data/settings.json bagian "midtrans" (diisi sekali oleh
// pemilik; folder data tidak disajikan ke web). TIDAK disimpan di kode.
// PowerShell:  $env:MIDTRANS_SERVER_KEY="SB-Mid-server-..." ; $env:MIDTRANS_CLIENT_KEY="SB-Mid-client-..." ; node server.js
function readPermanentSettings() {
  try {
    const parsed = JSON.parse(readFileSync(join(ROOT, "data", "settings.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
const fileMidtrans = readPermanentSettings().midtrans || {};
const envServerKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
const envClientKey = (process.env.MIDTRANS_CLIENT_KEY || "").trim();
const midtransFromEnv = Boolean(envServerKey && envClientKey);
const MIDTRANS_SERVER_KEY = midtransFromEnv ? envServerKey : String(fileMidtrans.serverKey || "").trim();
const MIDTRANS_CLIENT_KEY = midtransFromEnv ? envClientKey : String(fileMidtrans.clientKey || "").trim();
const MIDTRANS_SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const paymentsEnabled = Boolean(MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY);
const midtransSource = paymentsEnabled ? (midtransFromEnv ? "environment" : "file") : null;

// ---------- Database ----------
mkdirSync(join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(join(ROOT, "data", "tmii.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    whatsapp TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    code TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unpaid',
    date TEXT NOT NULL,
    adults INTEGER NOT NULL DEFAULT 0,
    children INTEGER NOT NULL DEFAULT 0,
    items TEXT NOT NULL,
    buyer TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    service_fee INTEGER NOT NULL,
    email_status TEXT NOT NULL DEFAULT '',
    is_example INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
`);

const seedOrders = [
  {
    code: "TMII-2026-0001", status: "unpaid", date: "2026-12-26", adults: 2, children: 1,
    items: [{ id: "tiket-masuk", qty: 3 }, { id: "anjungan", qty: 3 }],
    buyer: { name: "Pengguna contoh", whatsapp: "081200000000", email: "nama@email.com" },
    paymentMethod: "qris", emailStatus: "Belum dikirim, menunggu pembayaran", isExample: true,
  },
  {
    code: "TMII-2026-0000", status: "paid", date: "2026-12-26", adults: 2, children: 1,
    items: [{ id: "tiket-masuk", qty: 3 }, { id: "kereta-gantung", qty: 3 }],
    buyer: { name: "Pengguna contoh", whatsapp: "081200000000", email: "nama@email.com" },
    paymentMethod: "qris", emailStatus: "Terkirim ke email pemesan (contoh)", isExample: true,
  },
  {
    code: "TMII-2026-0002", status: "paid", date: "2026-12-27", adults: 2, children: 2,
    items: [{ id: "paket-keluarga", qty: 1 }],
    buyer: { name: "Pengguna contoh", whatsapp: "081200000000", email: "nama@email.com" },
    paymentMethod: "ewallet", emailStatus: "Terkirim ke email pemesan (contoh)", isExample: true,
  },
];

const orderCount = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
if (orderCount === 0) {
  const insert = db.prepare(`INSERT INTO orders
    (code, owner_email, status, date, adults, children, items, buyer, payment_method, service_fee, email_status, is_example, created_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const o of seedOrders) {
    insert.run(o.code, o.status, o.date, o.adults, o.children,
      JSON.stringify(o.items), JSON.stringify(o.buyer), o.paymentMethod,
      SERVICE_FEE, o.emailStatus, o.isExample ? 1 : 0, new Date().toISOString());
  }
  console.log("Database baru dibuat dan diisi 3 pesanan contoh.");
}

// Kolom peran (user / admin) untuk database lama yang belum punya
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

// Migrasi nama email akun bawaan mengikuti pola nama pemilik (25 Nov):
// database lama yang masih memakai email lama diganti namanya di sini,
// dan sesi aktif ikut dipindahkan supaya tidak terputus.
for (const [lama, baru] of [
  ["admin@tmii.id", "superadmin.nurdin@tmii.id"],
  ["admin2@tmii.id", "admin.nurdin@tmii.id"],
]) {
  const sumber = db.prepare("SELECT id FROM users WHERE email = ?").get(lama);
  const tujuan = db.prepare("SELECT id FROM users WHERE email = ?").get(baru);
  if (sumber && !tujuan) {
    db.prepare("UPDATE users SET email = ? WHERE email = ?").run(baru, lama);
    db.prepare("UPDATE sessions SET email = ? WHERE email = ?").run(baru, lama);
    console.log(`Email akun bawaan diganti: ${lama} -> ${baru}`);
  }
}

// Akun super admin bawaan (kata sandi: admin123, segera ganti setelah masuk pertama kali)
const ADMIN_EMAIL = "superadmin.nurdin@tmii.id";
const ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL);
if (!existingAdmin) {
  db.prepare("INSERT INTO users (name, email, whatsapp, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'admin')")
    .run("Super Admin", ADMIN_EMAIL, "081200000000", ADMIN_PASSWORD_HASH, new Date().toISOString());
  console.log(`Akun super admin dibuat: ${ADMIN_EMAIL} (kata sandi awal: admin123)`);
} else {
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(ADMIN_EMAIL);
}


// ---------- Peran dan izin ----------
// Peran disimpan di tabel roles dan setiap peran membawa daftar izin.
// Super admin bisa menambah dan mengubah peran dari panel admin.
const PERMISSION_CATALOG = [
  { key: "dashboard", label: "Panel admin (Ringkasan)" },
  { key: "revenue", label: "Lihat laporan & grafik pendapatan" },
  { key: "users.read", label: "Lihat pengguna" },
  { key: "users.create", label: "Tambah pengguna" },
  { key: "users.update", label: "Ubah pengguna" },
  { key: "users.delete", label: "Hapus pengguna" },
  { key: "orders.read", label: "Lihat pesanan" },
  { key: "orders.update", label: "Ubah pesanan" },
  { key: "orders.delete", label: "Hapus pesanan" },
  { key: "scan", label: "Pindai dan validasi tiket" },
  { key: "logs", label: "Lihat log pemindaian" },
  { key: "roles.manage", label: "Kelola peran" },
];
const ALL_PERMISSIONS = PERMISSION_CATALOG.map((p) => p.key);
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    name TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
const seedRole = (name, label, permissions) =>
  db.prepare("INSERT OR IGNORE INTO roles (name, label, permissions, is_system, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(name, label, JSON.stringify(permissions), new Date().toISOString());
seedRole("superadmin", "Super Admin", ALL_PERMISSIONS);
seedRole("admin", "Admin", ["dashboard", "users.read", "users.create", "users.update", "orders.read", "orders.update", "logs"]);
seedRole("scanner", "Scanner", ["scan"]);
seedRole("user", "Pengguna", []);
// Akun super admin bawaan memakai peran superadmin
db.prepare("UPDATE users SET role = 'superadmin' WHERE email = ?").run(ADMIN_EMAIL);

let roleCache = null;
function loadRoles() {
  roleCache = new Map(
    db.prepare("SELECT * FROM roles").all().map((r) => [r.name, { ...r, permissions: JSON.parse(r.permissions || "[]") }]),
  );
  return roleCache;
}
function permissionsFor(roleName) {
  if (!roleCache) loadRoles();
  return roleCache.get(roleName)?.permissions || [];
}
function hasPerm(user, perm) {
  return Boolean(user) && permissionsFor(user.role).includes(perm);
}
function hasAnyAdminPerm(user) {
  return Boolean(user) && permissionsFor(user.role).length > 0;
}

// Tiga peran contoh dari dokumen Role, dibuat sebagai peran biasa
// (bukan bawaan) supaya tetap bisa diubah izinnya atau dihapus.
const seedCustomRole = (name, label, permissions) =>
  db.prepare("INSERT OR IGNORE INTO roles (name, label, permissions, is_system, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(name, label, JSON.stringify(permissions), new Date().toISOString());
seedCustomRole("manajer", "Manajer", ["dashboard", "users.read", "orders.read", "logs", "revenue"]);
seedCustomRole("cs-loket", "Customer Service", ["dashboard", "users.read", "users.update", "orders.read", "orders.update", "logs"]);
seedCustomRole("scanner-cadangan", "Scanner Cadangan", ["scan"]);

// Akun scanner contoh, satu akun per titik pindai (kata sandi awal: scan123)
const SCANNER_PASSWORD_HASH = "b332bf15cdb33b6ce8f6d34f007a294f00e01b8675ee55a76f4de4650fe596b7";
for (const sc of [
  { name: "Gerbang 1", email: "gerbang1@tmii.id", whatsapp: "081200000001" },
  { name: "Pintu Istana Boneka", email: "istana@tmii.id", whatsapp: "081200000002" },
]) {
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(sc.email);
  if (!exists) {
    db.prepare("INSERT INTO users (name, email, whatsapp, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'scanner')")
      .run(sc.name, sc.email, sc.whatsapp, SCANNER_PASSWORD_HASH, new Date().toISOString());
    console.log(`Akun scanner dibuat: ${sc.email} (kata sandi awal: scan123)`);
  }
}

// Akun Admin contoh, terpisah dari Super Admin (emailnya harus beda:
// Super Admin memakai superadmin.nurdin@tmii.id). Kata sandi awal: admin123.
{
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get("admin.nurdin@tmii.id");
  if (!exists) {
    db.prepare("INSERT INTO users (name, email, whatsapp, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'admin')")
      .run("Admin", "admin.nurdin@tmii.id", "081200000003", ADMIN_PASSWORD_HASH, new Date().toISOString());
    console.log("Akun admin dibuat: admin.nurdin@tmii.id (kata sandi awal: admin123)");
  }
}

// ---------- Sistem e-tiket aman ----------
// ID tiket acak (UUID v4), payload QR ditandatangani HMAC-SHA256, dan setiap
// pemindaian tercatat di log audit. Kunci tanda tangan bisa diatur lewat
// environment TMII_TICKET_SECRET; kalau kosong, dibuat sekali lalu disimpan
// di tabel settings (tidak pernah dikirim ke browser).
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    order_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TEXT NOT NULL,
    redeemed_at TEXT,
    redeemed_by TEXT
  );
  CREATE TABLE IF NOT EXISTS scan_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT,
    order_code TEXT,
    result TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    scanner_id TEXT NOT NULL DEFAULT '',
    officer_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_email TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

// Kolom penanda wajib ganti sandi (sesudah direset Super Admin) untuk
// database lama yang belum punya.
{
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("must_change_password")) {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  }
}

let TICKET_SECRET = (process.env.TMII_TICKET_SECRET || "").trim();
if (!TICKET_SECRET) {
  const saved = db.prepare("SELECT value FROM settings WHERE key = 'ticket_secret'").get();
  if (saved) {
    TICKET_SECRET = saved.value;
  } else {
    TICKET_SECRET = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO settings (key, value) VALUES ('ticket_secret', ?)").run(TICKET_SECRET);
  }
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", TICKET_SECRET).update(body).digest("base64url");
  return `T1.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "T1") return null;
  const expected = createHmac("sha256", TICKET_SECRET).update(parts[1]).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const ticketColumns = db.prepare("PRAGMA table_info(tickets)").all().map((c) => c.name);
if (!ticketColumns.includes("scan_code")) {
  db.exec("ALTER TABLE tickets ADD COLUMN scan_code TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_scan_code ON tickets (scan_code)");

// Migrasi izin "revenue" (dokumen laporan pendapatan, 25 Nov 2026):
// super admin selalu memegang seluruh izin di katalog, termasuk yang baru.
db.prepare("UPDATE roles SET permissions = ? WHERE name = 'superadmin'").run(JSON.stringify(ALL_PERMISSIONS));
roleCache = null;
// Peran Manajer yang sudah terlanjur dibuat sebelum izin ini ada diberi
// izin revenue satu kali saja; sesudah itu bebas diubah dari panel.
if (!db.prepare("SELECT value FROM settings WHERE key = 'migration_revenue_v1'").get()) {
  const manajer = db.prepare("SELECT permissions FROM roles WHERE name = 'manajer'").get();
  if (manajer) {
    const perms = JSON.parse(manajer.permissions);
    if (!perms.includes("revenue")) {
      perms.push("revenue");
      db.prepare("UPDATE roles SET permissions = ? WHERE name = 'manajer'").run(JSON.stringify(perms));
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_revenue_v1', '1')").run();
}
// Pesanan lunas lama (termasuk 3 contoh bawaan) yang belum punya paid_at
// diisi dari created_at, supaya laporan pendapatan murni berbasis paid_at.
db.prepare("UPDATE orders SET paid_at = created_at WHERE status = 'paid' AND (paid_at IS NULL OR paid_at = '')").run();

// Kode pindai pendek khusus barcode batang: 12 huruf/angka acak (sekitar 60 bit).
// UUID penuh terlalu rapat digambar sebagai barcode di layar, jadi barcode
// memakai kode ini; QR tetap membawa UUID + tanda tangan.
const SCAN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newScanCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = randomBytes(12);
    let code = "";
    for (const b of bytes) code += SCAN_ALPHABET[b % SCAN_ALPHABET.length];
    const clash = db.prepare("SELECT id FROM tickets WHERE scan_code = ?").get(code);
    if (!clash) return code;
  }
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function ensureTicketForOrder(orderRow) {
  if (!orderRow || orderRow.status !== "paid") return null;
  let ticket = db.prepare("SELECT * FROM tickets WHERE order_code = ?").get(orderRow.code);
  if (!ticket) {
    db.prepare("INSERT INTO tickets (id, order_code, status, issued_at, scan_code) VALUES (?, ?, 'active', ?, ?)")
      .run(randomUUID(), orderRow.code, new Date().toISOString(), newScanCode());
    ticket = db.prepare("SELECT * FROM tickets WHERE order_code = ?").get(orderRow.code);
  } else if (!ticket.scan_code) {
    db.prepare("UPDATE tickets SET scan_code = ? WHERE id = ?").run(newScanCode(), ticket.id);
    ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id);
  }
  return ticket;
}

function ticketPayload(orderRow, ticketRow, step) {
  const payload = {
    tid: ticketRow.id,
    code: orderRow.code,
    date: orderRow.date,
    a: orderRow.adults,
    c: orderRow.children,
  };
  if (step !== undefined) payload.step = step;
  return payload;
}

const scanAttempts = new Map();

function todayJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

// Sapuan awal: semua pesanan lunas yang belum punya tiket diterbitkan tiketnya
for (const row of db.prepare("SELECT * FROM orders WHERE status = 'paid'").all()) {
  ensureTicketForOrder(row);
}

// ---------- Helpers ----------
// Batas waktu pembayaran: pesanan yang belum dibayar lewat 10 menit
// otomatis dibatalkan.
const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

function expireStaleOrders() {
  const cutoff = new Date(Date.now() - PAYMENT_WINDOW_MS).toISOString();
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE status = 'unpaid' AND created_at < ?").run(cutoff);
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    code: row.code,
    ownerEmail: row.owner_email,
    status: row.status,
    date: row.date,
    adults: row.adults,
    children: row.children,
    items: JSON.parse(row.items),
    buyer: JSON.parse(row.buyer),
    paymentMethod: row.payment_method,
    serviceFee: row.service_fee,
    emailStatus: row.email_status,
    isExample: Boolean(row.is_example),
    createdAt: row.created_at,
    expiresAt: row.status === "unpaid"
      ? new Date(new Date(row.created_at).getTime() + PAYMENT_WINDOW_MS).toISOString()
      : undefined,
    paidAt: row.paid_at || undefined,
  };
}

function withTicket(order, row) {
  if (!order || order.status !== "paid") return order;
  const ticket = ensureTicketForOrder(row);
  if (ticket) {
    order.ticket = { id: ticket.id, status: ticket.status, scanCode: ticket.scan_code };
    order.qrPayload = signPayload(ticketPayload(row, ticket));
  }
  return order;
}

function publicUser(row) {
  return {
    name: row.name,
    email: row.email,
    whatsapp: row.whatsapp,
    role: row.role || "user",
    permissions: permissionsFor(row.role || "user"),
    mustChangePassword: Boolean(row.must_change_password),
  };
}

function authUser(req) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const session = db.prepare("SELECT email FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  return db.prepare("SELECT * FROM users WHERE email = ?").get(session.email) || null;
}

// Akses ke satu pesanan: pemilik yang sedang masuk ATAU tamu yang tahu
// kode pesanan + kontak pemesan (email/WhatsApp yang sama dengan data
// pemesan). Ini pola yang sama dengan halaman Cek Pesanan publik dan
// cara Ancol bekerja: beli sebagai tamu, pesanan dikenali dari kontak.
function orderAccess(req, row, contactRaw) {
  const user = authUser(req);
  const buyer = JSON.parse(row.buyer);
  if (user && (row.owner_email === user.email || buyer.email === user.email))
    return { user, buyer, ok: true };
  const contact = String(contactRaw || "").trim().toLowerCase();
  const matches = Boolean(contact) &&
    (buyer.email.toLowerCase() === contact || buyer.whatsapp === contact.replace(/[\s-]/g, ""));
  return { user, buyer, ok: matches };
}

function makeOrderCode() {
  const existing = new Set(db.prepare("SELECT code FROM orders").all().map((r) => r.code));
  let code;
  do {
    code = `TMII-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (existing.has(code));
  return code;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
  // Wajib mengembalikan nilai truthy: pola penjaga izin
  //   const denied = need(perm); if (denied) return denied;
  // bergantung pada ini. Tanpa return, penolakan izin terkirim ke klien
  // tetapi handler tetap lanjut dan aksinya tetap dijalankan.
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("Body terlalu besar"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("JSON tidak valid")); }
    });
    req.on("error", reject);
  });
}

// ---------- Laporan pendapatan & ringkasan operasional ----------
// Semua tanggal dibaca dalam zona Asia/Jakarta, apa pun zona servernya.
const jakartaDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
const dayKeyOf = (ts) => jakartaDayFmt.format(new Date(ts));
const keyFromUTC = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function addDaysKey(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return keyFromUTC(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function mondayKeyOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Senin = 0
  return addDaysKey(key, -dow);
}
function dayLabelID(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
function monthLabelID(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function paidOrdersParsed() {
  const rows = db.prepare("SELECT code, items, service_fee, paid_at FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL AND paid_at != ''").all();
  return rows.map((r) => {
    const items = JSON.parse(r.items);
    const itemsTotal = items.reduce((sum, it) => sum + (ticketById(it.id)?.price || 0) * (it.qty || 0), 0);
    return { code: r.code, items, itemsTotal, total: itemsTotal + (r.service_fee || 0), ts: r.paid_at };
  });
}

function revenueReport() {
  const paid = paidOrdersParsed();
  const todayKey = dayKeyOf(Date.now());
  const byDay = new Map();
  const byMonth = new Map();
  const perItem = new Map();
  for (const o of paid) {
    const day = dayKeyOf(o.ts);
    const d = byDay.get(day) || { total: 0, orders: 0 };
    d.total += o.total;
    d.orders += 1;
    byDay.set(day, d);
    const month = day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + o.total);
    for (const it of o.items) {
      const t = ticketById(it.id);
      if (!t) continue;
      const p = perItem.get(it.id) || { id: it.id, name: t.name, category: t.category, total: 0, qty: 0 };
      p.total += t.price * (it.qty || 0);
      p.qty += it.qty || 0;
      perItem.set(it.id, p);
    }
  }
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const key = addDaysKey(todayKey, -i);
    const d = byDay.get(key) || { total: 0, orders: 0 };
    daily.push({ date: key, label: dayLabelID(key), total: d.total, orders: d.orders });
  }
  const weeklyMap = new Map();
  for (const [day, d] of byDay) {
    const wk = mondayKeyOf(day);
    weeklyMap.set(wk, (weeklyMap.get(wk) || 0) + d.total);
  }
  const thisMonday = mondayKeyOf(todayKey);
  const weekly = [];
  for (let i = 7; i >= 0; i--) {
    const key = addDaysKey(thisMonday, -7 * i);
    weekly.push({ weekStart: key, label: dayLabelID(key), total: weeklyMap.get(key) || 0 });
  }
  const monthly = [];
  {
    const [cy, cm] = todayKey.slice(0, 7).split("-").map(Number);
    for (let i = 5; i >= 0; i--) {
      let mm = cm - i;
      let yy = cy;
      while (mm < 1) { mm += 12; yy -= 1; }
      const key = `${yy}-${String(mm).padStart(2, "0")}`;
      monthly.push({ month: key, label: monthLabelID(key), total: byMonth.get(key) || 0 });
    }
  }
  const growth = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
  const weekTotal = (k) => weeklyMap.get(k) || 0;
  const monthTotal = (k) => byMonth.get(k) || 0;
  const thisMonth = todayKey.slice(0, 7);
  const [cy, cm] = thisMonth.split("-").map(Number);
  const prevMonth = cm === 1 ? `${cy - 1}-12` : `${cy}-${String(cm - 1).padStart(2, "0")}`;
  const todayData = byDay.get(todayKey) || { total: 0, orders: 0 };
  const yestData = byDay.get(addDaysKey(todayKey, -1)) || { total: 0, orders: 0 };
  return {
    cards: {
      today: { total: todayData.total, orders: todayData.orders, growth: growth(todayData.total, yestData.total) },
      week: { total: weekTotal(thisMonday), growth: growth(weekTotal(thisMonday), weekTotal(addDaysKey(thisMonday, -7))) },
      month: { total: monthTotal(thisMonth), growth: growth(monthTotal(thisMonth), monthTotal(prevMonth)) },
    },
    daily,
    weekly,
    monthly,
    perItem: [...perItem.values()].sort((a, b) => b.total - a.total),
  };
}

function overviewReport() {
  const paid = paidOrdersParsed();
  const ticketsSold = paid.reduce((sum, o) => sum + o.items.reduce((s, it) => s + (it.qty || 0), 0), 0);
  const checkins = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'redeemed'").get().n;
  const todayKey = dayKeyOf(Date.now());
  const counts = new Map();
  for (const o of paid) {
    const day = dayKeyOf(o.ts);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const dailyOrders = [];
  for (let i = 13; i >= 0; i--) {
    const key = addDaysKey(todayKey, -i);
    dailyOrders.push({ date: key, label: dayLabelID(key), orders: counts.get(key) || 0 });
  }
  const gates = db.prepare("SELECT scanner_id, COUNT(*) AS n FROM scan_logs WHERE result = 'success' GROUP BY scanner_id ORDER BY n DESC LIMIT 8").all()
    .map((g) => ({ gate: g.scanner_id || "Tidak dikenal", count: g.n }));
  return { ticketsSold, checkins, dailyOrders, gates };
}

// ---------- API ----------
function markOrderPaid(code, methodLabel) {
  const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
  if (!row || row.status !== "unpaid") return row;
  const buyer = JSON.parse(row.buyer);
  const emailStatus = `Terkirim ke ${buyer.email} (simulasi versi contoh)`;
  db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, email_status = ?, payment_method = ? WHERE code = ?")
    .run(new Date().toISOString(), emailStatus, methodLabel || row.payment_method, code);
  notifyTicketByEmail(code);
  return db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
}

// Kirim e-tiket beneran bila email sudah diatur di environment; tanpa itu
// status pesanan tetap simulasi.
async function deliverTicketEmail(code) {
  const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
  if (!row || row.status !== "paid") return null;
  const order = withTicket(rowToOrder(row), row);
  const email = order.buyer.email;
  try {
    await sendTicketEmail(order);
    const status = `Terkirim ke ${email}`;
    db.prepare("UPDATE orders SET email_status = ? WHERE code = ?").run(status, code);
    console.log(`E-tiket ${code} terkirim ke ${email}`);
    return status;
  } catch (error) {
    const status = `Gagal kirim ke ${email}: ${error.message}`;
    db.prepare("UPDATE orders SET email_status = ? WHERE code = ?").run(status, code);
    console.error(`E-tiket ${code} gagal dikirim: ${error.message}`);
    return status;
  }
}

// Versi latar untuk momen lunas: tidak menahan respons pembayaran.
function notifyTicketByEmail(code) {
  if (!mailConfigured()) return;
  const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
  if (!row || row.status !== "paid") return;
  const email = JSON.parse(row.buyer).email;
  db.prepare("UPDATE orders SET email_status = ? WHERE code = ?")
    .run(`Mengirim e-tiket ke ${email}...`, code);
  deliverTicketEmail(code);
}

async function handleAPI(req, res, url) {
  const path = url.pathname;
  if (path.startsWith("/api/orders") || path.startsWith("/api/admin")) expireStaleOrders();

  if (path === "/api/config" && req.method === "GET") {
    return sendJSON(res, 200, {
      payments: {
        enabled: paymentsEnabled,
        provider: "Midtrans sandbox",
        clientKey: MIDTRANS_CLIENT_KEY,
      },
    });
  }

  // Webhook Midtrans: server Midtrans memberi tahu pembayaran yang lunas.
  // Hanya bisa masuk bila situs punya alamat publik (bukan localhost).
  if (path === "/api/payments/notification" && req.method === "POST") {
    if (!paymentsEnabled) return sendJSON(res, 200, { ok: true });
    const body = await readBody(req);
    const expected = createHash("sha512")
      .update(`${body.order_id}${body.status_code}${body.gross_amount}${MIDTRANS_SERVER_KEY}`)
      .digest("hex");
    if (expected !== body.signature_key)
      return sendJSON(res, 403, { error: "Tanda tangan notifikasi tidak cocok." });
    const code = String(body.order_id || "").split("-").slice(0, 3).join("-").toUpperCase();
    const status = String(body.transaction_status || "");
    if (status === "settlement" || (status === "capture" && body.fraud_status !== "challenge")) {
      markOrderPaid(code, `midtrans-${body.payment_type || "online"}`);
    }
    return sendJSON(res, 200, { ok: true });
  }

  if (path === "/api/register" && req.method === "POST") {
    const { name, email, whatsapp, passwordHash } = await readBody(req);
    if (!name || !email || !whatsapp || !passwordHash)
      return sendJSON(res, 400, { error: "Data pendaftaran belum lengkap." });
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
    if (exists) return sendJSON(res, 409, { error: "Email ini sudah terdaftar. Silakan masuk." });
    db.prepare("INSERT INTO users (name, email, whatsapp, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(String(name).trim(), cleanEmail, String(whatsapp).trim(), String(passwordHash), new Date().toISOString());
    const token = randomBytes(24).toString("hex");
    db.prepare("DELETE FROM sessions WHERE email = ?").run(cleanEmail);
    db.prepare("INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?)")
      .run(token, cleanEmail, new Date().toISOString());
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(cleanEmail);
    return sendJSON(res, 201, { token, user: publicUser(user) });
  }

  if (path === "/api/login" && req.method === "POST") {
    const { email, passwordHash } = await readBody(req);
    const cleanEmail = String(email || "").trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(cleanEmail);
    if (!user || user.password_hash !== String(passwordHash || ""))
      return sendJSON(res, 401, { error: "Email atau kata sandi tidak cocok." });
    const token = randomBytes(24).toString("hex");
    db.prepare("DELETE FROM sessions WHERE email = ?").run(cleanEmail);
    db.prepare("INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?)")
      .run(token, cleanEmail, new Date().toISOString());
    return sendJSON(res, 200, { token, user: publicUser(user) });
  }

  if (path === "/api/logout" && req.method === "POST") {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Lupa & ganti kata sandi ----------
  // Jalur pengunjung: mandiri lewat email (tautan 15 menit, sekali pakai,
  // maks 3 permintaan per jam per email/IP, jawaban selalu umum agar tidak
  // membocorkan email mana yang terdaftar). Akun pengelola TIDAK PERNAH
  // direset lewat jalur publik ini; mereka direset Super Admin dari panel.
  if (path === "/api/password/forgot" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const target = email ? db.prepare("SELECT * FROM users WHERE email = ?").get(email) : null;
    if (target && (target.role || "user") === "user") {
      const ip = req.socket.remoteAddress || "";
      const hourAgo = new Date(Date.now() - 3600e3).toISOString();
      const recent = db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE (email = ? OR ip = ?) AND created_at > ?").get(email, ip, hourAgo).n;
      if (recent < 3) {
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        db.prepare("INSERT INTO password_resets (email, token_hash, expires_at, ip, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(email, tokenHash, new Date(Date.now() + 15 * 60e3).toISOString(), ip, new Date().toISOString());
        const link = `http://localhost:${PORT}/reset-sandi.html?token=${token}`;
        if (mailConfigured()) {
          sendPlainEmail({
            to: email,
            subject: "Reset kata sandi TMII Tiket",
            text: `Halo ${target.name},\n\nKlik tautan ini untuk membuat kata sandi baru (berlaku 15 menit, hanya bisa dipakai sekali):\n${link}\n\nKalau kamu tidak merasa meminta reset, abaikan email ini.`,
            html: `<p>Halo ${target.name},</p><p>Klik tautan ini untuk membuat kata sandi baru (berlaku 15 menit, hanya bisa dipakai sekali):</p><p><a href="${link}">${link}</a></p><p>Kalau kamu tidak merasa meminta reset, abaikan email ini.</p>`,
          }).catch(() => {});
        } else {
          console.log(`[simulasi email] Tautan reset sandi untuk ${email}: ${link}`);
        }
      }
    }
    return sendJSON(res, 200, { ok: true, message: "Jika email terdaftar, tautan reset telah dikirim." });
  }

  if (path === "/api/password/reset" && req.method === "POST") {
    const body = await readBody(req);
    const token = String(body.token || "");
    const passwordHash = String(body.passwordHash || "");
    if (!token || !passwordHash)
      return sendJSON(res, 400, { error: "Tautan atau kata sandi baru belum lengkap." });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(tokenHash);
    if (!row || row.used_at || new Date(row.expires_at) < new Date())
      return sendJSON(res, 400, { error: "Tautan reset tidak berlaku atau sudah kedaluwarsa. Minta tautan baru ya." });
    db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(passwordHash, row.email);
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    // Aturan pengaman wajib: semua sesi aktif akun ini dihanguskan.
    db.prepare("DELETE FROM sessions WHERE email = ?").run(row.email);
    return sendJSON(res, 200, { ok: true });
  }

  // Ganti sandi oleh pemilik akun yang sedang masuk (dipakai halaman paksa
  // ganti sandi sesudah staf direset Super Admin).
  if (path === "/api/password/change" && req.method === "POST") {
    const user = authUser(req);
    if (!user) return sendJSON(res, 401, { error: "Belum masuk." });
    const body = await readBody(req);
    const passwordHash = String(body.passwordHash || "");
    if (!passwordHash) return sendJSON(res, 400, { error: "Kata sandi baru belum diisi." });
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE email = ?").run(passwordHash, user.email);
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    db.prepare("DELETE FROM sessions WHERE email = ? AND token != ?").run(user.email, token);
    return sendJSON(res, 200, { ok: true });
  }

  if (path === "/api/me" && req.method === "GET") {
    const user = authUser(req);
    if (!user) return sendJSON(res, 401, { error: "Belum masuk." });
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (path === "/api/orders" && req.method === "GET") {
    const user = authUser(req);
    if (!user) return sendJSON(res, 401, { error: "Belum masuk." });
    const rows = db.prepare(
      "SELECT * FROM orders WHERE owner_email = ? OR buyer LIKE ? ORDER BY created_at DESC"
    ).all(user.email, `%"email":"${user.email}"%`);
    return sendJSON(res, 200, { orders: rows.map((r) => withTicket(rowToOrder(r), r)) });
  }

  if (path === "/api/orders" && req.method === "POST") {
    // Tamu boleh memesan tanpa akun (pola Ancol): pesanan dikenali dari
    // email pemesan; kalau pembeli sedang masuk, akunnya yang dicatat.
    const user = authUser(req);
    const body = await readBody(req);
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((item) => ({ id: String(item.id), qty: Math.max(0, Number(item.qty) || 0) }))
      .filter((item) => ticketById(item.id) && item.qty > 0);
    if (!items.length) return sendJSON(res, 400, { error: "Keranjang masih kosong." });
    const buyer = {
      name: String(body.buyer?.name || "").trim(),
      whatsapp: String(body.buyer?.whatsapp || "").trim(),
      email: String(body.buyer?.email || "").trim().toLowerCase(),
    };
    if (buyer.name.length < 2 || !buyer.email.includes("@"))
      return sendJSON(res, 400, { error: "Data pemesan belum lengkap." });
    const code = makeOrderCode();
    db.prepare(`INSERT INTO orders
      (code, owner_email, status, date, adults, children, items, buyer, payment_method, service_fee, email_status, is_example, created_at)
      VALUES (?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, 'Belum dikirim, menunggu pembayaran', 0, ?)`)
      .run(code, user?.email || buyer.email, String(body.date || ""), Number(body.adults) || 0, Number(body.children) || 0,
        JSON.stringify(items), JSON.stringify(buyer), String(body.paymentMethod || "qris"),
        SERVICE_FEE, new Date().toISOString());
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    return sendJSON(res, 201, { order: withTicket(rowToOrder(row), row) });
  }

  const orderMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
  if (orderMatch && req.method === "GET") {
    const code = orderMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const access = orderAccess(req, row, url.searchParams.get("contact"));
    if (!access.ok)
      return sendJSON(res, 403, { error: "Kode atau kontak tidak cocok dengan pesanan ini." });
    return sendJSON(res, 200, { order: withTicket(rowToOrder(row), row) });
  }

  const payMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/pay$/);
  if (payMatch && req.method === "POST") {
    const code = payMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const body = await readBody(req);
    const { buyer, ok } = orderAccess(req, row, body.contact);
    if (!ok) return sendJSON(res, 403, { error: "Pesanan ini bukan milik kamu." });
    if (row.status === "cancelled")
      return sendJSON(res, 400, { error: "Pesanan ini sudah dibatalkan karena melewati batas waktu pembayaran 10 menit. Buat pesanan baru ya." });
    const emailStatus = `Terkirim ke ${buyer.email} (simulasi versi contoh)`;
    db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, email_status = ? WHERE code = ?")
      .run(new Date().toISOString(), emailStatus, code);
    notifyTicketByEmail(code);
    const updated = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    return sendJSON(res, 200, { order: withTicket(rowToOrder(updated), updated) });
  }

  const resendMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/resend-email$/);
  if (resendMatch && req.method === "POST") {
    const code = resendMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const body = await readBody(req);
    const access = orderAccess(req, row, body.contact);
    const user = access.user;
    if (!access.ok && !(user && hasPerm(user, "orders.update")))
      return sendJSON(res, 403, { error: "Pesanan ini bukan milik kamu." });
    if (row.status !== "paid")
      return sendJSON(res, 400, { error: "E-tiket hanya dikirim untuk pesanan yang sudah dibayar." });
    if (!mailConfigured())
      return sendJSON(res, 400, { error: "Email belum diatur di server, jadi pengiriman masih simulasi. Atur TMII_MAIL_USER dan TMII_MAIL_PASS, atau isi berkas data/settings.json, lalu nyalakan ulang server." });
    await deliverTicketEmail(code);
    const updated = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    return sendJSON(res, 200, { order: withTicket(rowToOrder(updated), updated) });
  }

  const tokenMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/payment-token$/);
  if (tokenMatch && req.method === "POST") {
    if (!paymentsEnabled)
      return sendJSON(res, 400, { error: "Payment gateway belum diatur. Jalankan server dengan kunci Midtrans sandbox (environment atau berkas data/settings.json)." });
    const code = tokenMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const body = await readBody(req);
    const { buyer, ok } = orderAccess(req, row, body.contact);
    if (!ok) return sendJSON(res, 403, { error: "Pesanan ini bukan milik kamu." });
    if (row.status === "paid") return sendJSON(res, 400, { error: "Pesanan ini sudah dibayar." });
    if (row.status === "cancelled")
      return sendJSON(res, 400, { error: "Pesanan ini sudah dibatalkan karena melewati batas waktu pembayaran 10 menit. Buat pesanan baru ya." });

    const items = JSON.parse(row.items);
    const itemDetails = items.map((item) => {
      const ticket = ticketById(item.id);
      return {
        id: item.id,
        price: ticket ? ticket.price : 0,
        quantity: item.qty,
        name: (ticket ? ticket.name : item.id).slice(0, 50),
      };
    });
    itemDetails.push({ id: "biaya-layanan", price: row.service_fee, quantity: 1, name: "Biaya layanan" });
    const grossAmount = itemDetails.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const midtransOrderId = `${code}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const response = await fetch(MIDTRANS_SNAP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString("base64")}`,
        },
        body: JSON.stringify({
          transaction_details: { order_id: midtransOrderId, gross_amount: grossAmount },
          item_details: itemDetails,
          customer_details: {
            first_name: buyer.name.slice(0, 50),
            email: buyer.email,
            phone: buyer.whatsapp,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        const detail =
          (Array.isArray(data.error_messages) && data.error_messages[0]) ||
          data.status_message ||
          `HTTP ${response.status}`;
        console.log("Midtrans menolak permintaan token:", response.status, JSON.stringify(data));
        return sendJSON(res, 502, { error: `Midtrans: ${detail}` });
      }
      return sendJSON(res, 200, { token: data.token, redirectUrl: data.redirect_url });
    } catch {
      return sendJSON(res, 502, { error: "Tidak bisa menghubungi Midtrans. Periksa koneksi internet laptop." });
    }
  }

  const cancelMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const code = cancelMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const body = await readBody(req);
    const { ok } = orderAccess(req, row, body.contact);
    if (!ok) return sendJSON(res, 403, { error: "Pesanan ini bukan milik kamu." });
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE code = ?").run(code);
    const updated = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    return sendJSON(res, 200, { order: withTicket(rowToOrder(updated), updated) });
  }

  // ---------- Super Admin ----------

  // QR dinamis untuk halaman e-tiket: token baru tiap 30 detik, jadi
  // tangkapan layar cepat kedaluwarsa. PDF dan email memakai token statis.
  const qrMatch = path.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/qr$/);
  if (qrMatch && req.method === "GET") {
    const code = qrMatch[1].toUpperCase();
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
    if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
    const { ok } = orderAccess(req, row, url.searchParams.get("contact"));
    if (!ok) return sendJSON(res, 403, { error: "Pesanan ini bukan milik kamu." });
    const ticket = ensureTicketForOrder(row);
    if (!ticket) return sendJSON(res, 400, { error: "E-tiket hanya untuk pesanan yang sudah dibayar." });
    const step = Math.floor(Date.now() / 30000);
    return sendJSON(res, 200, {
      token: signPayload(ticketPayload(row, ticket, step)),
      refreshIn: 30 - (Math.floor(Date.now() / 1000) % 30),
    });
  }

  // Validasi + penukaran tiket oleh petugas (admin). Setiap percobaan,
  // berhasil atau ditolak, masuk log audit. Batas laju: 30 pindai per menit.
  if (path === "/api/tickets/validate" && req.method === "POST") {
    const user = authUser(req);
    if (!hasPerm(user, "scan"))
      return sendJSON(res, 403, { error: "Validasi tiket hanya untuk petugas yang berizin memindai." });
    const now = Date.now();
    const attempts = (scanAttempts.get(user.email) || []).filter((t) => now - t < 60000);
    if (attempts.length >= 30) {
      db.prepare("INSERT INTO scan_logs (ticket_id, order_code, result, reason, scanner_id, officer_email, created_at) VALUES (NULL, NULL, 'rejected', 'Terlalu banyak percobaan (rate limit)', '', ?, ?)")
        .run(user.email, new Date().toISOString());
      return sendJSON(res, 429, { error: "Terlalu banyak percobaan pemindaian. Tunggu sebentar lalu coba lagi." });
    }
    attempts.push(now);
    scanAttempts.set(user.email, attempts);

    const body = await readBody(req);
    const scannerId = String(body.scannerId || "web").slice(0, 40);
    const checks = [];
    const logAndReply = (ok, ticketRow, orderRow) => {
      const reason = checks.filter((c) => !c.ok).map((c) => c.detail || c.label).join("; ");
      db.prepare("INSERT INTO scan_logs (ticket_id, order_code, result, reason, scanner_id, officer_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(ticketRow?.id || null, orderRow?.code || null, ok ? "success" : "rejected", reason, scannerId, user.email, new Date().toISOString());
      return sendJSON(res, 200, {
        ok,
        checks,
        ticket: ticketRow ? { id: ticketRow.id, orderCode: ticketRow.order_code, status: ticketRow.status } : null,
        message: ok ? "Tiket sah. Pengunjung boleh masuk." : `Tiket ditolak: ${reason}`,
      });
    };

    let payload = null;
    let ticket = null;
    if (body.token) {
      payload = verifyToken(String(body.token));
      checks.push({ key: "signature", label: "Tanda tangan digital sah", ok: Boolean(payload) });
      if (payload?.step !== undefined) {
        const currentStep = Math.floor(Date.now() / 30000);
        const fresh = payload.step === currentStep || payload.step === currentStep - 1;
        checks.push({ key: "freshness", label: "Kode QR masih segar (belum kedaluwarsa)", ok: fresh });
      }
      if (payload) ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(payload.tid) || null;
    } else if (body.ticketId) {
      checks.push({ key: "signature", label: "Pencarian manual berdasarkan ID tiket (tanpa tanda tangan)", ok: true });
      const key = String(body.ticketId).trim();
      ticket = db.prepare("SELECT * FROM tickets WHERE id = ? OR scan_code = ?").get(key, key.toUpperCase()) || null;
    } else {
      checks.push({ key: "signature", label: "Token atau ID tiket dikirim", ok: false });
    }
    checks.push({ key: "exists", label: "Tiket ditemukan di database", ok: Boolean(ticket) });
    if (!ticket) return logAndReply(false, null, null);

    const order = db.prepare("SELECT * FROM orders WHERE code = ?").get(ticket.order_code);
    checks.push({ key: "paid", label: "Pembayaran sudah lunas", ok: order?.status === "paid" });

    if (ticket.status === "active" && order && order.date < todayJakarta()) {
      db.prepare("UPDATE tickets SET status = 'expired' WHERE id = ?").run(ticket.id);
      ticket.status = "expired";
    }
    const statusOk = ticket.status === "active";
    checks.push({
      key: "status",
      label: "Status tiket masih aktif",
      ok: statusOk,
      detail: statusOk ? "" : ticket.status === "redeemed" ? `Sudah ditukarkan${ticket.redeemed_at ? ` pada ${ticket.redeemed_at}` : ""} oleh ${ticket.redeemed_by || "petugas"}` : `Status: ${ticket.status}`,
    });
    const dateOk = order?.date === todayJakarta();
    checks.push({
      key: "date",
      label: "Tanggal kunjungan adalah hari ini",
      ok: dateOk,
      detail: dateOk ? "" : `Tanggal tiket ${order?.date}, hari ini ${todayJakarta()}`,
    });

    if (!checks.every((c) => c.ok)) return logAndReply(false, ticket, order);

    // Penukaran atomik: satu UPDATE bersyarat, hanya satu pemindai yang menang
    const result = db.prepare("UPDATE tickets SET status = 'redeemed', redeemed_at = ?, redeemed_by = ? WHERE id = ? AND status = 'active'")
      .run(new Date().toISOString(), user.email, ticket.id);
    if (result.changes !== 1) {
      checks.push({ key: "race", label: "Tiket belum ditukarkan petugas lain", ok: false });
      return logAndReply(false, db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id), order);
    }
    ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id);
    return logAndReply(true, ticket, order);
  }

  if (path === "/api/admin/scan-logs" && req.method === "GET") {
    const user = authUser(req);
    if (!hasPerm(user, "logs"))
      return sendJSON(res, 403, { error: "Log pemindaian hanya untuk pengelola yang berizin." });
    const rows = db.prepare("SELECT * FROM scan_logs ORDER BY id DESC LIMIT 50").all();
    return sendJSON(res, 200, { logs: rows });
  }

  if (path.startsWith("/api/admin/")) {
    const admin = authUser(req);
    if (!admin) return sendJSON(res, 401, { error: "Belum masuk." });
    if (!hasAnyAdminPerm(admin))
      return sendJSON(res, 403, { error: "Akun ini tidak punya akses pengelola." });
    const need = (perm) => {
      if (hasPerm(admin, perm)) return null;
      return sendJSON(res, 403, { error: `Peran kamu tidak punya izin: ${perm}` });
    };

    if (path === "/api/admin/stats" && req.method === "GET") {
      const denied = need("dashboard");
      if (denied) return denied;
      const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
      const orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
      const paid = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get().n;
      const unpaid = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'unpaid'").get().n;
      return sendJSON(res, 200, { stats: { users, orders, paid, unpaid } });
    }

    if (path === "/api/admin/overview" && req.method === "GET") {
      const denied = need("dashboard");
      if (denied) return denied;
      return sendJSON(res, 200, { overview: overviewReport() });
    }

    if (path === "/api/admin/revenue" && req.method === "GET") {
      const denied = need("revenue");
      if (denied) return denied;
      return sendJSON(res, 200, { revenue: revenueReport() });
    }

    if (path === "/api/admin/users" && req.method === "GET") {
      const denied = need("users.read");
      if (denied) return denied;
      const rows = db.prepare("SELECT id, name, email, whatsapp, role, created_at FROM users ORDER BY created_at").all();
      return sendJSON(res, 200, { users: rows });
    }

    if (path === "/api/admin/users" && req.method === "POST") {
      const denied = need("users.create");
      if (denied) return denied;
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const whatsapp = String(body.whatsapp || "").trim();
      const passwordHash = String(body.passwordHash || "");
      const role = String(body.role || "user");
      if (name.length < 2 || !email.includes("@") || !passwordHash)
        return sendJSON(res, 400, { error: "Nama, email, dan kata sandi akun baru belum lengkap." });
      if (!roleCache) loadRoles();
      if (!roleCache.has(role))
        return sendJSON(res, 400, { error: "Peran yang dipilih tidak dikenal." });
      const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (exists) return sendJSON(res, 409, { error: "Email ini sudah terdaftar." });
      db.prepare("INSERT INTO users (name, email, whatsapp, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)")
        .run(name, email, whatsapp, passwordHash, new Date().toISOString(), role);
      const created = db.prepare("SELECT id, name, email, whatsapp, role, created_at FROM users WHERE email = ?").get(email);
      return sendJSON(res, 201, { user: created });
    }

    const userMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && req.method === "PUT") {
      const denied = need("users.update");
      if (denied) return denied;
      const id = Number(userMatch[1]);
      const body = await readBody(req);
      const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!target) return sendJSON(res, 404, { error: "Pengguna tidak ditemukan." });
      const name = String(body.name ?? target.name).trim();
      const whatsapp = String(body.whatsapp ?? target.whatsapp).trim();
      const email = body.email === undefined || body.email === null ? target.email : String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return sendJSON(res, 400, { error: "Format email tidak valid." });
      if (email !== target.email) {
        const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, id);
        if (clash) return sendJSON(res, 400, { error: "Email itu sudah dipakai akun lain." });
      }
      const role = body.role === undefined ? target.role : String(body.role);
      if (!roleCache) loadRoles();
      if (!roleCache.has(role))
        return sendJSON(res, 400, { error: "Peran yang dipilih tidak dikenal." });
      if (email !== target.email && role === "user")
        return sendJSON(res, 400, { error: "Email akun pengunjung tidak bisa diubah dari panel." });
      if (target.email === admin.email && role !== target.role)
        return sendJSON(res, 400, { error: "Peran akun kamu sendiri tidak bisa diubah." });
      db.prepare("UPDATE users SET name = ?, email = ?, whatsapp = ?, role = ? WHERE id = ?")
        .run(name, email, whatsapp, role, id);
      if (email !== target.email)
        db.prepare("UPDATE sessions SET email = ? WHERE email = ?").run(email, target.email);
      const updated = db.prepare("SELECT id, name, email, whatsapp, role, created_at FROM users WHERE id = ?").get(id);
      return sendJSON(res, 200, { user: updated });
    }
    // Reset sandi staf oleh Super Admin (jalur manual dokumen): sandi
    // sementara diberikan langsung ke orangnya. Mereset sesama pengelola
    // khusus Super Admin; staf non-scanner wajib mengganti sandi
    // sementaranya saat masuk berikutnya. Semua sesi target dihanguskan
    // dan tindakannya dicatat di log aktivitas.
    const userPasswordMatch = path.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (userPasswordMatch && req.method === "PUT") {
      const denied = need("users.update");
      if (denied) return denied;
      const id = Number(userPasswordMatch[1]);
      const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!target) return sendJSON(res, 404, { error: "Pengguna tidak ditemukan." });
      if ((target.role || "user") !== "user" && admin.role !== "superadmin")
        return sendJSON(res, 403, { error: "Sandi akun pengelola hanya bisa direset oleh Super Admin." });
      const body = await readBody(req);
      const passwordHash = String(body.passwordHash || "");
      if (!passwordHash) return sendJSON(res, 400, { error: "Kata sandi sementara belum diisi." });
      const targetRole = target.role || "user";
      const mustChange = targetRole !== "user" && targetRole !== "scanner" ? 1 : 0;
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(passwordHash, mustChange, id);
      db.prepare("DELETE FROM sessions WHERE email = ?").run(target.email);
      db.prepare("INSERT INTO activity_logs (actor_email, action, target_email, detail, created_at) VALUES (?, 'reset-sandi', ?, ?, ?)")
        .run(admin.email, target.email, `Peran target: ${targetRole}`, new Date().toISOString());
      return sendJSON(res, 200, { ok: true, mustChangePassword: Boolean(mustChange) });
    }
    if (userMatch && req.method === "DELETE") {
      const denied = need("users.delete");
      if (denied) return denied;
      const id = Number(userMatch[1]);
      const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!target) return sendJSON(res, 404, { error: "Pengguna tidak ditemukan." });
      if (target.email === admin.email)
        return sendJSON(res, 400, { error: "Akun kamu sendiri tidak bisa dihapus." });
      db.prepare("DELETE FROM sessions WHERE email = ?").run(target.email);
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      return sendJSON(res, 200, { ok: true });
    }

    if (path === "/api/admin/orders" && req.method === "GET") {
      const denied = need("orders.read");
      if (denied) return denied;
      const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
      return sendJSON(res, 200, { orders: rows.map((r) => withTicket(rowToOrder(r), r)) });
    }

    const adminOrderMatch = path.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)$/);
    if (adminOrderMatch && req.method === "PUT") {
      const denied = need("orders.update");
      if (denied) return denied;
      const code = adminOrderMatch[1].toUpperCase();
      const body = await readBody(req);
      const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
      if (!row) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
      const status = ["unpaid", "paid", "cancelled"].includes(body.status) ? body.status : row.status;
      const date = String(body.date ?? row.date);
      const buyer = JSON.parse(row.buyer);
      if (body.buyer && typeof body.buyer === "object") {
        const name = String(body.buyer.name ?? buyer.name).trim();
        const whatsapp = String(body.buyer.whatsapp ?? buyer.whatsapp).trim();
        const email = String(body.buyer.email ?? buyer.email).trim().toLowerCase();
        if (name.length < 2 || whatsapp.length < 9 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return sendJSON(res, 400, { error: "Data pemesan belum benar: nama, WhatsApp, dan email wajib terisi dengan format yang benar." });
        buyer.name = name;
        buyer.whatsapp = whatsapp;
        buyer.email = email;
      }
      db.prepare("UPDATE orders SET status = ?, date = ?, buyer = ? WHERE code = ?")
        .run(status, date, JSON.stringify(buyer), code);
      const updated = db.prepare("SELECT * FROM orders WHERE code = ?").get(code);
      return sendJSON(res, 200, { order: withTicket(rowToOrder(updated), updated) });
    }
    if (adminOrderMatch && req.method === "DELETE") {
      const denied = need("orders.delete");
      if (denied) return denied;
      const code = adminOrderMatch[1].toUpperCase();
      const info = db.prepare("DELETE FROM orders WHERE code = ?").run(code);
      if (!info.changes) return sendJSON(res, 404, { error: "Pesanan tidak ditemukan." });
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- Peran (kelola peran hanya super admin / roles.manage) ----------
    if (path === "/api/admin/roles" && req.method === "GET") {
      if (!hasPerm(admin, "roles.manage") && !hasPerm(admin, "users.read"))
        return sendJSON(res, 403, { error: "Peran kamu tidak berizin melihat peran." });
      if (!roleCache) loadRoles();
      const memberRows = db.prepare("SELECT id, name, email, whatsapp, role, created_at FROM users ORDER BY name COLLATE NOCASE").all();
      const membersOf = {};
      for (const u of memberRows) {
        (membersOf[u.role] ||= []).push({ id: u.id, name: u.name, email: u.email, whatsapp: u.whatsapp, createdAt: u.created_at });
      }
      const roles = [...roleCache.values()].map((r) => ({
        name: r.name,
        label: r.label,
        permissions: r.permissions,
        isSystem: Boolean(r.is_system),
        userCount: (membersOf[r.name] || []).length,
        members: membersOf[r.name] || [],
      }));
      return sendJSON(res, 200, { roles, catalog: PERMISSION_CATALOG });
    }

    if (path === "/api/admin/roles" && req.method === "POST") {
      const denied = need("roles.manage");
      if (denied) return denied;
      const body = await readBody(req);
      const name = String(body.name || "").trim().toLowerCase();
      const label = String(body.label || "").trim();
      const permissions = Array.isArray(body.permissions)
        ? body.permissions.filter((p) => ALL_PERMISSIONS.includes(p))
        : [];
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name))
        return sendJSON(res, 400, { error: "Nama peran hanya boleh huruf kecil, angka, dan tanda hubung (2-31 karakter)." });
      if (label.length < 2)
        return sendJSON(res, 400, { error: "Label peran belum diisi." });
      if (!roleCache) loadRoles();
      if (roleCache.has(name))
        return sendJSON(res, 409, { error: "Nama peran ini sudah dipakai." });
      db.prepare("INSERT INTO roles (name, label, permissions, is_system, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(name, label, JSON.stringify(permissions), new Date().toISOString());
      roleCache = null;
      return sendJSON(res, 201, { role: { name, label, permissions, isSystem: false, userCount: 0 } });
    }

    const roleMatch = path.match(/^\/api\/admin\/roles\/([a-z0-9-]+)$/);
    if (roleMatch && req.method === "PUT") {
      const denied = need("roles.manage");
      if (denied) return denied;
      const name = roleMatch[1];
      if (name === "superadmin")
        return sendJSON(res, 400, { error: "Peran Super Admin terkunci dan tidak bisa diubah." });
      if (!roleCache) loadRoles();
      const target = roleCache.get(name);
      if (!target) return sendJSON(res, 404, { error: "Peran tidak ditemukan." });
      const body = await readBody(req);
      const label = String(body.label ?? target.label).trim();
      const permissions = Array.isArray(body.permissions)
        ? body.permissions.filter((p) => ALL_PERMISSIONS.includes(p))
        : target.permissions;
      if (label.length < 2)
        return sendJSON(res, 400, { error: "Label peran belum diisi." });
      db.prepare("UPDATE roles SET label = ?, permissions = ? WHERE name = ?")
        .run(label, JSON.stringify(permissions), name);
      roleCache = null;
      return sendJSON(res, 200, { role: { name, label, permissions, isSystem: Boolean(target.is_system) } });
    }
    if (roleMatch && req.method === "DELETE") {
      const denied = need("roles.manage");
      if (denied) return denied;
      const name = roleMatch[1];
      if (!roleCache) loadRoles();
      const target = roleCache.get(name);
      if (!target) return sendJSON(res, 404, { error: "Peran tidak ditemukan." });
      if (target.is_system)
        return sendJSON(res, 400, { error: "Peran bawaan tidak bisa dihapus." });
      const used = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ?").get(name).n;
      if (used > 0)
        return sendJSON(res, 400, { error: `Peran ini masih dipakai ${used} akun. Pindahkan dulu akun-akun itu ke peran lain.` });
      db.prepare("DELETE FROM roles WHERE name = ?").run(name);
      roleCache = null;
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: "Rute admin tidak ditemukan." });
  }

  return sendJSON(res, 404, { error: "Rute API tidak ditemukan." });
}

// ---------- Static files ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // Berkas sensitif tidak boleh bisa dibuka dari web: pura-pura tidak ada
  const blocked =
    pathname.startsWith("/data/") ||
    pathname === "/server.js" ||
    pathname === "/reset-superadmin.js" ||
    pathname === "/package.json" ||
    pathname.toLowerCase().endsWith(".md");
  const filePath = normalize(join(ROOT, pathname));
  if (blocked || !filePath.startsWith(ROOT)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Berkas tidak ditemukan");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Berkas tidak ditemukan");
  }
  const body = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleAPI(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJSON(res, 500, { error: "Server bermasalah. Coba lagi sebentar." });
  }
});

server.listen(PORT, () => {
  console.log(`TMII Tiket jalan di http://localhost:${PORT}`);
  console.log("Database: data/tmii.db (SQLite)");
  console.log(mailConfigured()
    ? `Email e-tiket: AKTIF, terkirim beneran ke email pemesan (sumber: ${mailConfig().source === "file" ? "berkas data/settings.json" : "environment"})`
    : "Email e-tiket: simulasi (atur TMII_MAIL_USER dan TMII_MAIL_PASS, atau isi data/settings.json, untuk mengirim beneran)");
  console.log(paymentsEnabled
    ? `Payment gateway: Midtrans sandbox AKTIF (sumber: ${midtransSource === "file" ? "berkas data/settings.json" : "environment"}).`
    : "Payment gateway: belum diatur (mode pembayaran contoh). Isi MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY, atau berkas data/settings.json, untuk mengaktifkan.");
  console.log("Tekan Ctrl+C untuk berhenti.");
});
