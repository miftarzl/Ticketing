import { SERVICE_FEE, ticketById } from "../data.js";
import { api, currentUser, endSession, fetchScanLogs, hasPermission, orderTotal } from "../store.js";
import { escapeHTML, formatIDR, formatVisitDate, qs, sha256, toast } from "../utils.js";

let sidebar = null;
let root = null;
let user = null;

// Halaman panel disamarkan bagi yang tidak berhak: yang melihat hanya
// halaman 404 biasa, seolah halaman panel tidak pernah ada.
export function showDisguised404() {
  document.title = "Halaman tidak ditemukan - TMII Tiket";
  document.body.innerHTML = `
    <div class="container" style="padding-top:72px">
      <div class="card empty-state" style="text-align:center">
        <h1 style="font-size:52px;margin-bottom:8px">404</h1>
        <h3>Halaman tidak ditemukan</h3>
        <p style="margin-inline:auto">Alamat yang kamu buka tidak tersedia di situs ini.</p>
        <a class="btn btn-primary" href="index.html">Kembali ke beranda</a>
      </div>
    </div>`;
}

let view = "ringkasan";
let users = [];
let orders = [];
let roles = [];
let catalog = [];
let scanLogs = null;
let stats = null;
let overview = null;
let revenue = null;
let pageLoader = null;
let rolesQuery = "";
let rolesFilter = "";

function reloadPage() {
  if (pageLoader) pageLoader();
  else load();
}
let query = "";
let pageSize = 10;
const listPage = { users: 1, orders: 1 };

function paginate(list, key) {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if (listPage[key] > totalPages) listPage[key] = totalPages;
  if (listPage[key] < 1) listPage[key] = 1;
  const start = (listPage[key] - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

function paginationHTML(key, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(listPage[key], totalPages);
  return `
    <div class="pagination">
      <label class="small">Tampilkan
        <select data-page-size aria-label="Jumlah data per halaman">
          ${[10, 30, 50].map((n) => `<option value="${n}" ${pageSize === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        per halaman</label>
      <span class="small muted">Halaman ${page} dari ${totalPages}, total ${total} data</span>
      <div class="pagination-nav">
        <button class="btn btn-outline" type="button" data-page-nav="prev" data-page-key="${key}" ${page <= 1 ? "disabled" : ""}>Sebelumnya</button>
        <button class="btn btn-outline" type="button" data-page-nav="next" data-page-key="${key}" ${page >= totalPages ? "disabled" : ""}>Berikutnya</button>
      </div>
    </div>`;
}

function filteredUsers() {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) =>
    u.name.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    u.whatsapp.toLowerCase().includes(q));
}

function filteredOrders() {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter((o) =>
    o.code.toLowerCase().includes(q) ||
    o.buyer.name.toLowerCase().includes(q) ||
    o.buyer.email.toLowerCase().includes(q) ||
    statusLabel(o.status).toLowerCase().includes(q) ||
    o.items.some((i) => (ticketById(i.id)?.name || "").toLowerCase().includes(q)));
}

function resultNote(shown, total) {
  if (!query.trim()) return "";
  return `<p class="small muted">Menampilkan ${shown} dari ${total} data untuk pencarian "${escapeHTML(query.trim())}".</p>`;
}

const VIEW_TITLES = {
  ringkasan: "Ringkasan",
  users: "Pengguna",
  orders: "Pesanan",
  roles: "Peran",
  logs: "Log Pemindaian",
};

function roleLabel(name) {
  return roles.find((r) => r.name === name)?.label || name;
}

function statusLabel(status) {
  if (status === "paid") return "Sudah dibayar";
  if (status === "cancelled") return "Dibatalkan";
  return "Belum dibayar";
}

function renderSidebar() {
  const item = (key, label) =>
    `<button type="button" class="admin-nav-item ${view === key ? "active" : ""}" data-view="${key}">${label}</button>`;
  sidebar.innerHTML = `
    <div class="admin-brand">
      <strong>TMII Admin</strong>
      <span>${escapeHTML(roleLabel(user.role))}</span>
    </div>
    <nav class="admin-nav" aria-label="Menu admin">
      ${item("ringkasan", "Ringkasan")}
      ${hasPermission("users.read") && !hasPermission("roles.manage") ? item("users", "Pengguna") : ""}
      ${hasPermission("orders.read") ? item("orders", "Pesanan") : ""}
      ${hasPermission("logs") ? item("logs", "Log Pemindaian") : ""}
      ${hasPermission("roles.manage") ? '<a class="admin-nav-item" href="peran.html">Peran &amp; Akun</a>' : ""}
      ${hasPermission("scan") ? '<a class="admin-nav-item" href="scan.html">Pindai Tiket</a>' : ""}
    </nav>
    <div class="admin-side-foot">
      <p><strong>${escapeHTML(user.name)}</strong><br><span>${escapeHTML(user.email)}</span></p>
      <button type="button" class="admin-side-link" data-logout>Keluar</button>
    </div>`;
}

function usersTable() {
  const list = filteredUsers();
  if (!list.length) {
    return `${resultNote(0, users.length)}<div class="card empty-state"><h3>Tidak ada pengguna yang cocok</h3><p>Coba kata kunci lain, misalnya nama atau potongan email.</p></div>`;
  }
  const rows = paginate(list, "users");
  return `
    ${hasPermission("users.create") ? '<p><button class="btn btn-primary" type="button" data-add-user>Tambah akun</button></p>' : ""}
    ${resultNote(list.length, users.length)}
    <div class="table-wrap card">
      <table class="data-table">
        <thead><tr><th>Nama</th><th>Email</th><th>WhatsApp</th><th>Peran</th><th>Aksi</th></tr></thead>
        <tbody>
          ${rows.map((u) => `
            <tr>
              <td>${escapeHTML(u.name)}</td>
              <td>${escapeHTML(u.email)}</td>
              <td>${escapeHTML(u.whatsapp)}</td>
              <td>${escapeHTML(roleLabel(u.role))}</td>
              <td class="table-actions">
                ${hasPermission("users.update") ? `<button class="btn btn-outline" type="button" data-edit-user="${u.id}">Ubah</button>` : ""}
                ${hasPermission("users.update") && (u.role === "user" || user.role === "superadmin") ? `<button class="btn btn-outline" type="button" data-reset-password="${u.id}">Reset sandi</button>` : ""}
                ${hasPermission("users.delete") ? `<button class="btn btn-ghost" type="button" data-delete-user="${u.id}">Hapus</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${paginationHTML("users", list.length)}`;
}

function ordersTable(list, total = list.length, withNote = false, paged = false) {
  if (!list.length) {
    return `${withNote ? resultNote(0, total) : ""}<div class="card empty-state"><h3>Tidak ada pesanan yang cocok</h3><p>Coba kata kunci lain, misalnya kode pesanan atau nama pemesan.</p></div>`;
  }
  const rows = paged ? paginate(list, "orders") : list;
  return `
    ${withNote ? resultNote(list.length, total) : ""}
    <div class="table-wrap card">
      <table class="data-table">
        <thead><tr><th>Kode</th><th>Pemesan</th><th>Tiket</th><th>Tanggal</th><th>Status</th><th>Total</th><th>Aksi</th></tr></thead>
        <tbody>
          ${rows.map((o) => `
            <tr>
              <td>${escapeHTML(o.code)}${o.isExample ? " (contoh)" : ""}</td>
              <td>${escapeHTML(o.buyer.name)}<br><span class="small muted">${escapeHTML(o.buyer.email)}</span></td>
              <td>${o.items.map((i) => `${i.qty} x ${escapeHTML(ticketById(i.id)?.name || i.id)}`).join(", ")}</td>
              <td>${formatVisitDate(o.date)}</td>
              <td>${statusLabel(o.status)}</td>
              <td>${formatIDR(orderTotal(o))}</td>
              <td class="table-actions">
                ${hasPermission("orders.update") ? `<button class="btn btn-outline" type="button" data-edit-order="${escapeHTML(o.code)}">Ubah</button>` : ""}
                ${hasPermission("orders.update") && o.status === "paid" ? `<button class="btn btn-ghost" type="button" data-resend-ticket="${escapeHTML(o.code)}">Kirim ulang e-tiket</button>` : ""}
                ${hasPermission("orders.delete") ? `<button class="btn btn-ghost" type="button" data-delete-order="${escapeHTML(o.code)}">Hapus</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${paged ? paginationHTML("orders", total) : ""}`;
}

function logsView() {
  if (!scanLogs) return `<p class="muted">Memuat log dari database...</p>`;
  if (!scanLogs.length) return `<div class="card empty-state"><h3>Belum ada pemindaian tercatat</h3><p>Setiap tiket yang dipindai petugas, berhasil atau ditolak, akan tercatat di sini.</p></div>`;
  return `
    <div class="table-wrap card">
      <table class="data-table">
        <thead><tr><th>Waktu</th><th>Hasil</th><th>Pesanan</th><th>Alasan / keterangan</th><th>Perangkat</th><th>Petugas</th></tr></thead>
        <tbody>
          ${scanLogs.map((log) => `
            <tr>
              <td>${escapeHTML(new Date(log.created_at).toLocaleString("id-ID"))}</td>
              <td>${log.result === "success" ? "Berhasil" : "Ditolak"}</td>
              <td>${escapeHTML(log.order_code || "-")}</td>
              <td>${escapeHTML(log.reason || "-")}</td>
              <td>${escapeHTML(log.scanner_id || "-")}</td>
              <td>${escapeHTML(log.officer_email || "-")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function formatIDRShort(value) {
  const v = Number(value) || 0;
  if (Math.abs(v) >= 1_000_000) return `Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (Math.abs(v) >= 1_000) return `Rp ${Math.round(v / 1_000).toLocaleString("id-ID")} rb`;
  return `Rp ${v.toLocaleString("id-ID")}`;
}

function growthBadge(growth, period) {
  if (growth === null || growth === undefined) return `<span class="small muted">belum ada pembanding</span>`;
  const up = growth >= 0;
  return `<span class="growth ${up ? "growth-up" : "growth-down"}">${up ? "naik" : "turun"} ${Math.abs(growth).toLocaleString("id-ID", { maximumFractionDigits: 1 })}% dari ${period}</span>`;
}

function lineChartSVG(points, color = "#178a50") {
  const w = 720, h = 190, padL = 8, padR = 8, padT = 16, padB = 22;
  const max = Math.max(...points.map((p) => p.total), 1);
  const stepX = (w - padL - padR) / Math.max(points.length - 1, 1);
  const xy = points.map((p, i) => [padL + i * stepX, padT + (1 - p.total / max) * (h - padT - padB)]);
  const line = xy.map((pt) => pt.map((n) => n.toFixed(1)).join(",")).join(" ");
  const area = `${padL},${h - padB} ${line} ${w - padR},${h - padB}`;
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Grafik garis pendapatan harian">
      <polygon points="${area}" fill="${color}" opacity="0.12"></polygon>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
      ${xy.map((pt, i) => `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="3" fill="${color}"><title>${escapeHTML(points[i].label)}: ${formatIDR(points[i].total)}</title></circle>`).join("")}
      <text x="${padL}" y="12" class="chart-max">${formatIDRShort(max)}</text>
      ${labelIdx.map((i) => `<text x="${xy[i][0].toFixed(1)}" y="${h - 6}" text-anchor="middle" class="chart-label">${escapeHTML(points[i].label)}</text>`).join("")}
    </svg>`;
}

function barChartSVG(bars, { color = "#0b8585", format = formatIDRShort } = {}) {
  const w = 720, h = 190, padT = 18, padB = 22;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = w / Math.max(bars.length, 1);
  const bw = Math.min(44, slot - 8);
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Diagram batang">
      ${bars.map((b, i) => {
        const bh = Math.max(2, (b.value / max) * (h - padT - padB));
        const x = i * slot + (slot - bw) / 2;
        const y = h - padB - bh;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"><title>${escapeHTML(b.label)}: ${format(b.value)}</title></rect>
        <text x="${(i * slot + slot / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="chart-value">${b.value ? format(b.value) : ""}</text>
        <text x="${(i * slot + slot / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="chart-label">${escapeHTML(b.label)}</text>`;
      }).join("")}
    </svg>`;
}

const DONUT_COLORS = ["#178a50", "#d98e00", "#ce4b1d", "#2f5da8", "#0b8585", "#7a4fa3"];
function donutSVG(slices) {
  const total = slices.reduce((s, x) => s + x.total, 0);
  if (!total) return `<p class="muted">Belum ada pendapatan tiket tercatat.</p>`;
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segments = slices.map((s, i) => {
    const frac = s.total / total;
    const seg = `<circle r="${r}" cx="90" cy="90" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="26" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-offset * c).toFixed(1)}" transform="rotate(-90 90 90)"><title>${escapeHTML(s.name)}: ${formatIDR(s.total)}</title></circle>`;
    offset += frac;
    return seg;
  }).join("");
  return `<div class="donut-layout">
      <svg class="donut-svg" viewBox="0 0 180 180" role="img" aria-label="Diagram donat pendapatan per tiket">${segments}
        <text x="90" y="86" text-anchor="middle" class="donut-total-label">Total tiket</text>
        <text x="90" y="107" text-anchor="middle" class="donut-total">${formatIDRShort(total)}</text>
      </svg>
      <ul class="donut-legend">
        ${slices.map((s, i) => `<li><span class="donut-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span><span class="donut-name">${escapeHTML(s.name)}</span><span class="donut-val">${formatIDR(s.total)} (${Math.round((s.total / total) * 100)}%)</span></li>`).join("")}
      </ul>
    </div>`;
}

function downloadRevenueCSV() {
  if (!revenue) return;
  const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const lines = [
    "Laporan Pendapatan TMII Tiket",
    `Diunduh pada,${esc(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }))}`,
    "",
    "Ringkasan",
    `Hari ini,${revenue.cards.today.total}`,
    `Minggu ini,${revenue.cards.week.total}`,
    `Bulan ini,${revenue.cards.month.total}`,
    "",
    "Pendapatan harian (30 hari terakhir)",
    "Tanggal,Pendapatan (Rp),Pesanan lunas",
    ...revenue.daily.map((d) => `${d.date},${d.total},${d.orders}`),
    "",
    "Pendapatan mingguan (8 minggu terakhir)",
    "Minggu mulai,Pendapatan (Rp)",
    ...revenue.weekly.map((w) => `${w.weekStart},${w.total}`),
    "",
    "Pendapatan bulanan (6 bulan terakhir)",
    "Bulan,Pendapatan (Rp)",
    ...revenue.monthly.map((m) => `${esc(m.label)},${m.total}`),
    "",
    "Pendapatan per tiket (tanpa biaya layanan)",
    "Tiket,Kategori,Terjual (qty),Pendapatan (Rp)",
    ...revenue.perItem.map((p) => `${esc(p.name)},${p.category},${p.qty},${p.total}`),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `laporan-pendapatan-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Laporan pendapatan diunduh.");
}

function ringkasanView() {
  if (!stats) return `<p class="muted">Memuat data dari database...</p>`;
  const parts = [`
    <div class="stat-grid">
      <article class="card stat-card"><span>Pengguna terdaftar</span><strong>${stats.users}</strong></article>
      <article class="card stat-card"><span>Total pesanan</span><strong>${stats.orders}</strong></article>
      <article class="card stat-card"><span>Sudah dibayar</span><strong>${stats.paid}</strong></article>
      <article class="card stat-card"><span>Belum dibayar</span><strong>${stats.unpaid}</strong></article>
    </div>`];
  if (overview) {
    parts.push(`
    <h2 class="admin-h2">Operasional</h2>
    <div class="stat-grid">
      <article class="card stat-card"><span>Tiket terjual</span><strong>${overview.ticketsSold}</strong></article>
      <article class="card stat-card"><span>Pengunjung check-in</span><strong>${overview.checkins}</strong></article>
    </div>
    <div class="chart-grid">
      <article class="card chart-card">
        <h3>Pesanan lunas per hari (14 hari terakhir)</h3>
        ${barChartSVG(overview.dailyOrders.map((d) => ({ label: d.label, value: d.orders })), { color: "#0b8585", format: (v) => String(v) })}
      </article>
      <article class="card chart-card">
        <h3>Check-in per gerbang</h3>
        ${overview.gates.length ? barChartSVG(overview.gates.map((g) => ({ label: g.gate, value: g.count })), { color: "#178a50", format: (v) => String(v) }) : '<p class="muted">Belum ada check-in tercatat.</p>'}
      </article>
    </div>`);
  }
  if (hasPermission("revenue") && revenue) {
    parts.push(`
    <h2 class="admin-h2">Pendapatan</h2>
    <div class="stat-grid">
      <article class="card stat-card"><span>Pendapatan hari ini</span><strong>${formatIDR(revenue.cards.today.total)}</strong><span class="growth-line">${growthBadge(revenue.cards.today.growth, "kemarin")}</span></article>
      <article class="card stat-card"><span>Pendapatan minggu ini</span><strong>${formatIDR(revenue.cards.week.total)}</strong><span class="growth-line">${growthBadge(revenue.cards.week.growth, "minggu lalu")}</span></article>
      <article class="card stat-card"><span>Pendapatan bulan ini</span><strong>${formatIDR(revenue.cards.month.total)}</strong><span class="growth-line">${growthBadge(revenue.cards.month.growth, "bulan lalu")}</span></article>
      ${user && user.role === "superadmin" ? '<article class="card stat-card export-card"><span>Laporan keuangan</span><button class="btn btn-outline" type="button" data-export-revenue>Unduh laporan (CSV)</button><span class="small muted">Untuk rekonsiliasi; berkas CSV bisa dibuka di Excel.</span></article>' : ""}
    </div>
    <div class="chart-grid">
      <article class="card chart-card">
        <h3>Tren pendapatan harian (30 hari terakhir)</h3>
        ${lineChartSVG(revenue.daily)}
      </article>
      <article class="card chart-card">
        <h3>Pendapatan per tiket</h3>
        ${donutSVG(revenue.perItem)}
      </article>
      <article class="card chart-card">
        <h3>Pendapatan mingguan (8 minggu terakhir)</h3>
        ${barChartSVG(revenue.weekly.map((w) => ({ label: w.label, value: w.total })), { color: "#2f5da8" })}
      </article>
      <article class="card chart-card">
        <h3>Pendapatan bulanan (6 bulan terakhir)</h3>
        ${barChartSVG(revenue.monthly.map((m) => ({ label: m.label, value: m.total })), { color: "#d98e00" })}
      </article>
    </div>
    <p class="small muted">Pendapatan dihitung dari pesanan yang sudah dibayar, termasuk biaya layanan ${formatIDR(SERVICE_FEE)} per pesanan. Diagram donat hanya membagi pendapatan tiket, tanpa biaya layanan.</p>`);
  }
  parts.push(`
    <h2 class="admin-h2">Pesanan terbaru</h2>
    ${ordersTable(filteredOrders().slice(0, 5), orders.length, true)}`);
  return parts.join("");
}

function contentHTML() {
  if (view === "ringkasan") return ringkasanView();
  if (view === "users") return usersTable();
  if (view === "roles") return rolesView();
  if (view === "logs") return logsView();
  return ordersTable(filteredOrders(), orders.length, true, true);
}

function render() {
  renderSidebar();
  root.innerHTML = `
    <header class="admin-topbar">
      <div>
        <h1>${VIEW_TITLES[view]}</h1>
        <p>Semua perubahan di panel ini langsung mengubah database.</p>
      </div>
      <div class="admin-top-actions">
        <div class="admin-search">
          <label class="sr-only" for="admin-search-input">Cari data</label>
          <input id="admin-search-input" data-admin-search type="search" placeholder="Cari nama, email, kode pesanan..." value="${escapeHTML(query)}" autocomplete="off">
        </div>
        <span class="status-tag status-paid">Database terhubung</span>
      </div>
    </header>
    <div id="admin-content">${contentHTML()}</div>`;
}

function updateContent() {
  const target = qs("#admin-content");
  if (target) target.innerHTML = contentHTML();
}

async function load() {
  try {
    const canRoles = hasPermission("users.read") || hasPermission("roles.manage");
    const [statsData, usersData, ordersData, rolesData, logsData, overviewData, revenueData] = await Promise.all([
      api("/api/admin/stats"),
      hasPermission("users.read") ? api("/api/admin/users") : Promise.resolve({ users }),
      hasPermission("orders.read") ? api("/api/admin/orders") : Promise.resolve({ orders }),
      canRoles ? api("/api/admin/roles") : Promise.resolve(null),
      hasPermission("logs") ? fetchScanLogs().then((logs) => ({ logs })).catch(() => ({ logs: scanLogs || [] })) : Promise.resolve(null),
      api("/api/admin/overview").catch(() => null),
      hasPermission("revenue") ? api("/api/admin/revenue").catch(() => null) : Promise.resolve(null),
    ]);
    stats = statsData.stats;
    users = usersData.users;
    orders = ordersData.orders;
    if (logsData) scanLogs = logsData.logs;
    if (overviewData) overview = overviewData.overview;
    if (revenueData) revenue = revenueData.revenue;
    if (rolesData) {
      roles = rolesData.roles;
      catalog = rolesData.catalog;
    }
    render();
  } catch (error) {
    toast(error.message, "error");
  }
}

function openDialog(html) {
  const dialog = qs("#admin-dialog");
  dialog.innerHTML = html;
  dialog.showModal();
}

function closeDialog() {
  const dialog = qs("#admin-dialog");
  if (dialog.open) dialog.close();
}


// Reset sandi akun oleh pengelola (jalur manual): Super Admin mengisi
// sandi sementara (atau membuatkan yang acak) lalu memberikannya langsung
// ke pemilik akun. Server mengakhiri semua sesi akun itu dan mencatatnya.
function resetPassword(id) {
  const target = users.find((item) => item.id === id);
  if (!target) return;
  const targetRole = target.role || "user";
  const willForce = targetRole !== "user" && targetRole !== "scanner";
  openDialog(`
    <form class="dialog-inner" id="reset-password-form">
      <h2 id="admin-dialog-title">Reset sandi akun</h2>
      <p class="small muted">Akun: ${escapeHTML(target.name)} (${escapeHTML(target.email)}). Sesudah direset, semua sesi akun ini diakhiri dan ia harus masuk lagi dengan sandi sementara ini.${willForce ? " Saat masuk, ia akan diminta membuat sandi pribadi baru." : ""} Berikan sandi sementaranya langsung ke orangnya, jangan lewat grup.</p>
      <div class="field">
        <label for="reset-password-input">Kata sandi sementara</label>
        <input id="reset-password-input" name="password" type="text" placeholder="Minimal 6 karakter" required>
      </div>
      <p><button class="btn btn-ghost" type="button" id="generate-password">Buat sandi acak</button></p>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Reset sandi</button>
        <button class="btn btn-ghost" type="button" data-close-dialog>Batal</button>
      </div>
    </form>`);
  qs("#generate-password")?.addEventListener("click", () => {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const numbers = new Uint32Array(10);
    crypto.getRandomValues(numbers);
    let generated = "";
    for (const n of numbers) generated += alphabet[n % alphabet.length];
    qs("#reset-password-input").value = generated;
  });
  qs("#reset-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") || "");
    if (password.length < 6) {
      toast("Kata sandi sementara minimal 6 karakter.", "error");
      return;
    }
    try {
      await api(`/api/admin/users/${target.id}/password`, { method: "PUT", body: { passwordHash: await sha256(password) } });
      closeDialog();
      toast(`Sandi ${target.email} sudah direset. Berikan sandi sementaranya langsung ke orangnya.`);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function editUser(id) {
  const u = users.find((item) => item.id === id);
  if (!u) return;
  openDialog(`
    <form class="dialog-inner" id="edit-user-form">
      <h2 id="admin-dialog-title">Ubah pengguna</h2>
      <div class="field">
        <label for="edit-name">Nama</label>
        <input id="edit-name" name="name" type="text" value="${escapeHTML(u.name)}" required>
      </div>
      ${u.role === "user" ? `
      <p class="small muted">Email akun pengunjung tidak diubah dari panel: ${escapeHTML(u.email)}</p>` : `
      <div class="field">
        <label for="edit-email">Email</label>
        <input id="edit-email" name="email" type="email" value="${escapeHTML(u.email)}" required>
        <span class="hint">Kalau email diganti, akun ini masuk lagi memakai email barunya; sesi aktifnya ikut dipindahkan.</span>
      </div>`}
      <div class="field">
        <label for="edit-whatsapp">Nomor WhatsApp</label>
        <input id="edit-whatsapp" name="whatsapp" type="tel" value="${escapeHTML(u.whatsapp)}" required>
      </div>
      <div class="field">
        <label for="edit-role">Peran</label>
        <select id="edit-role" name="role">
          ${roles.length
            ? roles.map((r) => `<option value="${escapeHTML(r.name)}" ${u.role === r.name ? "selected" : ""}>${escapeHTML(r.label)}</option>`).join("")
            : `<option value="${escapeHTML(u.role)}" selected>${escapeHTML(u.role)}</option>`}
        </select>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn btn-outline" type="button" data-close-dialog>Batal</button>
      </div>
    </form>`);
  qs("#edit-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = { name: data.get("name"), whatsapp: data.get("whatsapp"), role: data.get("role") };
    if (data.get("email") !== null) payload.email = data.get("email");
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PUT",
        body: payload,
      });
      closeDialog();
      toast("Pengguna diperbarui.");
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function editOrder(code) {
  const o = orders.find((item) => item.code === code);
  if (!o) return;
  openDialog(`
    <form class="dialog-inner" id="edit-order-form">
      <h2 id="admin-dialog-title">Ubah pesanan ${escapeHTML(o.code)}</h2>
      <div class="field">
        <label for="edit-status">Status</label>
        <select id="edit-status" name="status">
          <option value="unpaid" ${o.status === "unpaid" ? "selected" : ""}>Belum dibayar</option>
          <option value="paid" ${o.status === "paid" ? "selected" : ""}>Sudah dibayar</option>
          <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Dibatalkan</option>
        </select>
      </div>
      <div class="field">
        <label for="edit-date">Tanggal kunjungan</label>
        <input id="edit-date" name="date" type="date" value="${escapeHTML(o.date)}" required>
      </div>
      <div class="field">
        <label for="edit-buyer-name">Nama pemesan</label>
        <input id="edit-buyer-name" name="buyerName" type="text" value="${escapeHTML(o.buyer.name)}" required>
      </div>
      <div class="field">
        <label for="edit-buyer-whatsapp">WhatsApp pemesan</label>
        <input id="edit-buyer-whatsapp" name="buyerWhatsapp" type="tel" value="${escapeHTML(o.buyer.whatsapp)}" required>
      </div>
      <div class="field">
        <label for="edit-buyer-email">Email pemesan</label>
        <input id="edit-buyer-email" name="buyerEmail" type="email" value="${escapeHTML(o.buyer.email)}" required>
        <span class="hint">E-tiket terkirim ke email ini. Betulkan bila pengunjung salah mengetik emailnya, lalu pakai tombol Kirim ulang e-tiket.</span>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn btn-outline" type="button" data-close-dialog>Batal</button>
      </div>
    </form>`);
  qs("#edit-order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/orders/${code}`, {
        method: "PUT",
        body: {
          status: data.get("status"),
          date: data.get("date"),
          buyer: { name: data.get("buyerName"), whatsapp: data.get("buyerWhatsapp"), email: data.get("buyerEmail") },
        },
      });
      closeDialog();
      toast("Pesanan diperbarui.");
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function roleOptions(selected) {
  return roles.map((r) => `<option value="${escapeHTML(r.name)}" ${selected === r.name ? "selected" : ""}>${escapeHTML(r.label)}</option>`).join("");
}

function addUser(presetRole = "user") {
  openDialog(`
    <form class="dialog-inner" id="add-user-form">
      <h2 id="admin-dialog-title">Tambah akun</h2>
      <div class="field">
        <label for="add-name">Nama</label>
        <input id="add-name" name="name" type="text" placeholder="Nama akun, misalnya nama petugas atau gerbang" required>
      </div>
      <div class="field">
        <label for="add-email">Email</label>
        <input id="add-email" name="email" type="email" placeholder="nama@tmii.id" required>
      </div>
      <div class="field">
        <label for="add-whatsapp">Nomor WhatsApp</label>
        <input id="add-whatsapp" name="whatsapp" type="tel" placeholder="08xxxxxxxxxx" required>
      </div>
      <div class="field">
        <label for="add-password">Kata sandi awal</label>
        <input id="add-password" name="password" type="text" placeholder="Kata sandi untuk masuk pertama kali" required>
      </div>
      <div class="field">
        <label for="add-role">Peran</label>
        <select id="add-role" name="role">${roleOptions(presetRole)}</select>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Buat akun</button>
        <button class="btn btn-outline" type="button" data-close-dialog>Batal</button>
      </div>
    </form>`);
  qs("#add-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (password.length < 6) {
      toast("Kata sandi awal minimal 6 karakter.", "error");
      return;
    }
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: {
          name: data.get("name"),
          email: data.get("email"),
          whatsapp: data.get("whatsapp"),
          passwordHash: await sha256(password),
          role: data.get("role"),
        },
      });
      closeDialog();
      toast("Akun baru dibuat.");
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function permChips(perms) {
  if (!perms.length) return `<span class="small muted">Tidak ada izin pengelola</span>`;
  return `<span class="perm-chips">${perms.map((p) => `<span class="perm-chip">${escapeHTML(catalog.find((c) => c.key === p)?.label || p)}</span>`).join("")}</span>`;
}

function formatJoinedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}

function memberRow(m, roleName) {
  return `
    <button type="button" class="role-member" data-view-account="${escapeHTML(m.email)}" data-account-role="${escapeHTML(roleName)}" title="Klik untuk melihat data akun">
      <span class="role-member-name">${escapeHTML(m.name)}</span>
      <span class="small muted">${escapeHTML(m.email)}</span>
    </button>`;
}

function roleMembers(r) {
  if (!Array.isArray(r.members)) return `${r.userCount ?? 0} akun`;
  if (!r.members.length) return `<span class="small muted">0 akun</span>`;
  const shown = r.members.slice(0, 3);
  const rest = r.members.length - shown.length;
  return `
    <strong>${r.userCount} akun</strong>
    <div class="role-members">
      ${shown.map((m) => memberRow(m, r.name)).join("")}
      ${rest > 0 ? `<button type="button" class="role-more" data-all-accounts="${escapeHTML(r.name)}">dan ${rest} akun lainnya, klik untuk melihat semua</button>` : ""}
    </div>`;
}

function accountDetail(email, roleName) {
  const role = roles.find((r) => r.name === roleName);
  const m = role?.members?.find((x) => x.email === email);
  if (!m || !role) return;
  openDialog(`
    <div class="dialog-inner">
      <h2 id="admin-dialog-title">Data akun</h2>
      <dl class="detail-list">
        <div><dt>Nama akun</dt><dd>${escapeHTML(m.name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHTML(m.email)}</dd></div>
        <div><dt>WhatsApp</dt><dd>${m.whatsapp ? escapeHTML(m.whatsapp) : "-"}</dd></div>
        <div><dt>Peran</dt><dd>${escapeHTML(role.label)} (${escapeHTML(role.name)})</dd></div>
        <div><dt>Terdaftar</dt><dd>${formatJoinedAt(m.createdAt) || "-"}</dd></div>
      </dl>
      <div class="dialog-actions">
        <button class="btn btn-outline" type="button" data-close-dialog>Tutup</button>
      </div>
    </div>`);
}

function roleAccountsDialog(roleName) {
  const role = roles.find((r) => r.name === roleName);
  if (!role) return;
  openDialog(`
    <div class="dialog-inner">
      <h2 id="admin-dialog-title">Akun berperan ${escapeHTML(role.label)}</h2>
      <div class="role-members">
        ${(role.members || []).map((m) => `
          <div class="role-member-static">
            <span class="role-member-name">${escapeHTML(m.name)}</span>
            <span class="small muted">${escapeHTML(m.email)}</span>
            <span class="small muted">${[m.whatsapp ? `WA ${escapeHTML(m.whatsapp)}` : "", formatJoinedAt(m.createdAt) ? `terdaftar ${formatJoinedAt(m.createdAt)}` : ""].filter(Boolean).join(" · ")}</span>
          </div>`).join("")}
      </div>
      <div class="dialog-actions">
        <button class="btn btn-outline" type="button" data-close-dialog>Tutup</button>
      </div>
    </div>`);
}

function rolesView() {
  return `
    <p><button class="btn btn-primary" type="button" data-add-role>Tambah peran</button></p>
    <div class="table-wrap card">
      <table class="data-table">
        <thead><tr><th>Peran</th><th>Nama sistem</th><th>Akun</th><th>Izin</th><th>Aksi</th></tr></thead>
        <tbody>
          ${roles.map((r) => `
            <tr>
              <td><strong>${escapeHTML(r.label)}</strong>${r.isSystem ? ' <span class="small muted">(bawaan)</span>' : ""}</td>
              <td>${escapeHTML(r.name)}</td>
              <td>${roleMembers(r)}</td>
              <td>${permChips(r.permissions)}</td>
              <td class="table-actions">
                ${r.name === "superadmin"
                  ? '<span class="small muted">Terkunci</span>'
                  : `<button class="btn btn-outline" type="button" data-edit-role="${escapeHTML(r.name)}">Ubah</button>
                     ${r.isSystem ? "" : `<button class="btn btn-ghost" type="button" data-delete-role="${escapeHTML(r.name)}">Hapus</button>`}`}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="small muted">Peran Super Admin selalu punya semua izin dan terkunci. Peran bawaan lain bisa diubah izinnya tapi tidak bisa dihapus. Peran baru yang kamu buat bisa dihapus selama belum dipakai akun mana pun.</p>`;
}

function permCheckboxes(selected) {
  return catalog.map((c) => `
    <label class="perm-check">
      <input type="checkbox" name="perm" value="${escapeHTML(c.key)}" ${selected.includes(c.key) ? "checked" : ""}>
      <span>${escapeHTML(c.label)}</span>
    </label>`).join("");
}

function roleFormDialog({ title, name, label, permissions, nameEditable }) {
  openDialog(`
    <form class="dialog-inner" id="role-form">
      <h2 id="admin-dialog-title">${escapeHTML(title)}</h2>
      <div class="field">
        <label for="role-label">Label peran</label>
        <input id="role-label" name="label" type="text" value="${escapeHTML(label)}" placeholder="Misalnya Petugas Gerbang" required>
      </div>
      ${nameEditable ? `
      <div class="field">
        <label for="role-name">Nama sistem</label>
        <input id="role-name" name="name" type="text" value="${escapeHTML(name)}" placeholder="huruf-kecil-tanpa-spasi" required>
        <span class="hint">Hanya huruf kecil, angka, dan tanda hubung. Nama sistem tidak bisa diubah setelah dibuat.</span>
      </div>` : ""}
      <div class="field">
        <span class="field-label">Izin peran ini</span>
        <div class="perm-checks">${permCheckboxes(permissions)}</div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Simpan</button>
        <button class="btn btn-outline" type="button" data-close-dialog>Batal</button>
      </div>
    </form>`);
  return qs("#role-form");
}

function addRole() {
  const form = roleFormDialog({ title: "Tambah peran", name: "", label: "", permissions: [], nameEditable: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api("/api/admin/roles", {
        method: "POST",
        body: { name: data.get("name"), label: data.get("label"), permissions: data.getAll("perm") },
      });
      closeDialog();
      toast("Peran baru dibuat.");
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function editRole(name) {
  const r = roles.find((item) => item.name === name);
  if (!r) return;
  const form = roleFormDialog({ title: `Ubah peran ${r.label}`, name: r.name, label: r.label, permissions: r.permissions, nameEditable: false });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api(`/api/admin/roles/${name}`, {
        method: "PUT",
        body: { label: data.get("label"), permissions: data.getAll("perm") },
      });
      closeDialog();
      toast("Peran diperbarui. Akun dengan peran ini mungkin perlu masuk ulang agar menunya berubah.");
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function confirmable(button, label, action) {
  if (button.dataset.confirm === "true") {
    action();
  } else {
    button.dataset.confirm = "true";
    button.textContent = "Klik lagi untuk hapus";
    window.setTimeout(() => {
      if (button.isConnected) {
        button.dataset.confirm = "false";
        button.textContent = label;
      }
    }, 3000);
  }
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-roles-search]")) {
    rolesQuery = event.target.value;
    updateRolesList();
    return;
  }
  if (event.target.matches("[data-admin-search]")) {
    query = event.target.value;
    listPage.users = 1;
    listPage.orders = 1;
    updateContent();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-roles-filter]")) {
    rolesFilter = event.target.value;
    updateRolesList();
    return;
  }
  if (event.target.matches("[data-page-size]")) {
    pageSize = Number(event.target.value) || 10;
    listPage.users = 1;
    listPage.orders = 1;
    updateContent();
  }
});

document.addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-page-nav]");
  if (navButton && !navButton.disabled) {
    const key = navButton.dataset.pageKey;
    listPage[key] += navButton.dataset.pageNav === "next" ? 1 : -1;
    updateContent();
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    view = viewButton.dataset.view;
    render();
    return;
  }
  if (event.target.closest("[data-logout]")) {
    endSession();
    window.location.href = "admin-login.html";
    return;
  }
  if (event.target.closest("[data-export-revenue]")) downloadRevenueCSV();
  if (event.target.closest("[data-close-dialog]")) {
    closeDialog();
    return;
  }
  const addUserButton = event.target.closest("[data-add-user]");
  if (addUserButton) addUser(addUserButton.dataset.addUser || "user");
  if (event.target.closest("[data-add-role]")) addRole();
  const editRoleButton = event.target.closest("[data-edit-role]");
  if (editRoleButton) editRole(editRoleButton.dataset.editRole);
  const accountButton = event.target.closest("[data-view-account]");
  if (accountButton) accountDetail(accountButton.dataset.viewAccount, accountButton.dataset.accountRole);
  const allAccountsButton = event.target.closest("[data-all-accounts]");
  if (allAccountsButton) roleAccountsDialog(allAccountsButton.dataset.allAccounts);
  const deleteRoleButton = event.target.closest("[data-delete-role]");
  if (deleteRoleButton) {
    confirmable(deleteRoleButton, "Hapus", async () => {
      try {
        await api(`/api/admin/roles/${deleteRoleButton.dataset.deleteRole}`, { method: "DELETE" });
        toast("Peran dihapus.");
        reloadPage();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
  const editUserButton = event.target.closest("[data-edit-user]");
  if (editUserButton) editUser(Number(editUserButton.dataset.editUser));
  const resetPasswordButton = event.target.closest("[data-reset-password]");
  if (resetPasswordButton) resetPassword(Number(resetPasswordButton.dataset.resetPassword));
  const editOrderButton = event.target.closest("[data-edit-order]");
  if (editOrderButton) editOrder(editOrderButton.dataset.editOrder);

  const resendButton = event.target.closest("[data-resend-ticket]");
  if (resendButton) {
    resendButton.disabled = true;
    try {
      const data = await api(`/api/orders/${resendButton.dataset.resendTicket}/resend-email`, { method: "POST" });
      toast(`E-tiket dikirim ulang. Status: ${data.order.emailStatus}`);
      reloadPage();
    } catch (error) {
      toast(error.message, "error");
      resendButton.disabled = false;
    }
  }
  const deleteUserButton = event.target.closest("[data-delete-user]");
  if (deleteUserButton) {
    confirmable(deleteUserButton, "Hapus", async () => {
      try {
        await api(`/api/admin/users/${deleteUserButton.dataset.deleteUser}`, { method: "DELETE" });
        toast("Pengguna dihapus dari database.");
        reloadPage();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
  const deleteOrderButton = event.target.closest("[data-delete-order]");
  if (deleteOrderButton) {
    confirmable(deleteOrderButton, "Hapus", async () => {
      try {
        await api(`/api/admin/orders/${deleteOrderButton.dataset.deleteOrder}`, { method: "DELETE" });
        toast("Pesanan dihapus dari database.");
        reloadPage();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
});

// Dipanggil halaman pemanggil (admin.js untuk Super Admin, panel.js
// untuk Admin) setelah gerbang perannya lolos.
export function mountAdminPanel() {
  sidebar = qs("#admin-sidebar");
  root = qs("#main");
  user = currentUser();
  pageLoader = null;
  render();
  load();
}

// ---------- Halaman Peran & Akun (peran.html) ----------
// Satu halaman khusus untuk mengelola peran dan semua akunnya sekaligus:
// CRUD peran, data akun lengkap, dan CRUD akun per peran.

function roleSection(r, shown = null) {
  const members = Array.isArray(r.members) ? r.members : [];
  const visible = shown ?? members;
  const searching = rolesQuery.trim() !== "";
  return `
    <section class="card role-section">
      <div class="role-section-head">
        <div>
          <h2>${escapeHTML(r.label)} <span class="small muted">(${escapeHTML(r.name)})</span></h2>
          <p class="small muted">${searching && visible.length !== members.length ? `${visible.length} dari ${members.length} akun` : `${members.length} akun`}${r.isSystem ? " · peran bawaan" : ""}</p>
        </div>
        <div class="table-actions">
          ${r.name === "superadmin"
            ? '<span class="small muted">Terkunci</span>'
            : `<button class="btn btn-outline" type="button" data-edit-role="${escapeHTML(r.name)}">Ubah peran</button>
               ${r.isSystem ? "" : `<button class="btn btn-ghost" type="button" data-delete-role="${escapeHTML(r.name)}">Hapus peran</button>`}`}
        </div>
      </div>
      <p>${permChips(r.permissions)}</p>
      ${visible.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Nama</th><th>Email</th><th>WhatsApp</th><th>Terdaftar</th><th>Aksi</th></tr></thead>
          <tbody>
            ${visible.map((m) => {
              const uid = m.id ?? users.find((u) => u.email === m.email)?.id;
              return `
              <tr>
                <td>${escapeHTML(m.name)}</td>
                <td>${escapeHTML(m.email)}</td>
                <td>${m.whatsapp ? escapeHTML(m.whatsapp) : "-"}</td>
                <td>${formatJoinedAt(m.createdAt) || "-"}</td>
                <td class="table-actions">
                  ${uid && hasPermission("users.update") ? `<button class="btn btn-outline" type="button" data-edit-user="${uid}">Ubah</button>` : ""}
                  ${uid && hasPermission("users.update") && (r.name === "user" || user.role === "superadmin") ? `<button class="btn btn-outline" type="button" data-reset-password="${uid}">Reset sandi</button>` : ""}
                  ${uid && hasPermission("users.delete") ? `<button class="btn btn-ghost" type="button" data-delete-user="${uid}">Hapus</button>` : ""}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : '<p class="small muted">Belum ada akun dengan peran ini.</p>'}
      ${hasPermission("users.create") ? `<p><button class="btn btn-outline" type="button" data-add-user="${escapeHTML(r.name)}">Tambah akun ${escapeHTML(r.label)}</button></p>` : ""}
    </section>`;
}

function rolesSectionsHTML() {
  const q = rolesQuery.trim().toLowerCase();
  const scoped = rolesFilter ? roles.filter((r) => r.name === rolesFilter) : roles;
  if (!q && !rolesFilter) return roles.map((r) => roleSection(r)).join("");
  let totalShown = 0;
  let totalAll = 0;
  const parts = [];
  for (const r of scoped) {
    const members = Array.isArray(r.members) ? r.members : [];
    totalAll += members.length;
    const roleHit = !q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    const shown = roleHit
      ? members
      : members.filter((m) => [m.name, m.email, m.whatsapp || ""].some((f) => f.toLowerCase().includes(q)));
    if (!shown.length && !roleHit) continue;
    totalShown += shown.length;
    parts.push(roleSection(r, shown));
  }
  if (!parts.length)
    return `<div class="card empty-state"><h3>Tidak ada akun yang cocok</h3><p>Coba kata kunci atau filter peran lain.</p></div>`;
  const scope = [
    q ? `pencarian "${escapeHTML(rolesQuery.trim())}"` : "",
    rolesFilter ? `peran ${escapeHTML(roleLabel(rolesFilter))}` : "",
  ].filter(Boolean).join(" dan ");
  return `<p class="small muted">Menampilkan ${totalShown} dari ${totalAll} akun untuk ${scope}.</p>` + parts.join("");
}

function updateRolesList() {
  const target = qs("#roles-list");
  if (target) target.innerHTML = rolesSectionsHTML();
}

function renderRolesPage() {
  const home = user.role === "superadmin" ? "admin.html" : hasPermission("dashboard") ? "panel.html" : null;
  sidebar.innerHTML = `
    <div class="admin-brand">
      <strong>TMII Admin</strong>
      <span>${escapeHTML(roleLabel(user.role))}</span>
    </div>
    <nav class="admin-nav" aria-label="Menu admin">
      ${home ? `<a class="admin-nav-item" href="${home}">← Kembali ke panel</a>` : ""}
      <span class="admin-nav-item active" aria-current="page">Peran &amp; Akun</span>
      ${hasPermission("scan") ? '<a class="admin-nav-item" href="scan.html">Pindai Tiket</a>' : ""}
    </nav>
    <div class="admin-side-foot">
      <p><strong>${escapeHTML(user.name)}</strong><br><span>${escapeHTML(user.email)}</span></p>
      <button type="button" class="admin-side-link" data-logout>Keluar</button>
    </div>`;
  root.innerHTML = `
    <header class="admin-topbar">
      <div>
        <h1>Peran &amp; Akun</h1>
        <p>Kelola semua peran dan akun pengelola di satu halaman. Semua perubahan langsung mengubah database.</p>
      </div>
      <div class="admin-top-actions">
        <div class="admin-search">
          <label class="sr-only" for="roles-search-input">Cari akun atau peran</label>
          <input id="roles-search-input" data-roles-search type="search" placeholder="Cari nama akun, email, WhatsApp, atau peran..." value="${escapeHTML(rolesQuery)}" autocomplete="off">
        </div>
        <div class="admin-filter">
          <label class="sr-only" for="roles-filter-select">Filter peran</label>
          <select id="roles-filter-select" data-roles-filter>
            <option value="">Semua peran</option>
            ${roles.map((r) => `<option value="${escapeHTML(r.name)}" ${rolesFilter === r.name ? "selected" : ""}>${escapeHTML(r.label)}</option>`).join("")}
          </select>
        </div>
        <span class="status-tag status-paid">Database terhubung</span>
      </div>
    </header>
    <p><button class="btn btn-primary" type="button" data-add-role>Tambah peran</button></p>
    <div class="roles-page-list" id="roles-list">
      ${rolesSectionsHTML()}
    </div>
    <p class="small muted">Peran Super Admin selalu punya semua izin dan terkunci. Peran bawaan lain bisa diubah izinnya tapi tidak bisa dihapus. Peran yang masih dipakai akun tidak bisa dihapus.</p>`;
}

async function loadRolesPage() {
  try {
    const [rolesData, usersData] = await Promise.all([
      api("/api/admin/roles"),
      hasPermission("users.read") ? api("/api/admin/users") : Promise.resolve({ users }),
    ]);
    roles = rolesData.roles;
    catalog = rolesData.catalog;
    users = usersData.users;
    renderRolesPage();
  } catch (error) {
    toast(error.message, "error");
  }
}

export function mountRolesPage() {
  sidebar = qs("#admin-sidebar");
  root = qs("#main");
  user = currentUser();
  pageLoader = loadRolesPage;
  renderRolesPage();
  loadRolesPage();
}
