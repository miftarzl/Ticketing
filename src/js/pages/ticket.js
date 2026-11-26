import { ticketById } from "../data.js";
import { fetchOrder, orderTotal } from "../store.js";
import {
  escapeHTML,
  formatIDR,
  formatVisitDate,
  toast,
  visitorsText,
} from "../utils.js";

export function qrImageDataURL(payload) {
  // Menggambar QR dari matriks qrcode-generator ke canvas, hasilnya PNG:
  // satu fungsi untuk gambar QR di web dan di dalam PDF.
  if (!window.qrcode || !payload) return "";
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(String(payload));
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 2; // zona tenang di tepi, wajib ada supaya QR terbaca
    const scale = Math.max(4, Math.floor(360 / (count + quiet * 2)));
    const size = (count + quiet * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) {
          ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
        }
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

async function qrDataURL(order) {
  // Payload resmi = token bertanda tangan HMAC dari server (isi: ID tiket,
  // kode pesanan, tanggal, jumlah pengunjung; tanpa nama/email/nomor HP).
  return qrImageDataURL(order.qrPayload || order.code);
}

export function ticketBarcodeValue(order) {
  // Barcode batang memakai kode pindai pendek: UUID penuh terlalu rapat
  // untuk digambar dan dipindai dari layar. QR yang membawa keamanan penuh.
  return order.ticket?.scanCode || order.ticket?.id || order.code;
}

export async function downloadTicketPDF(code) {
  let order = null;
  try {
    order = await fetchOrder(code);
  } catch {
    order = null;
  }
  if (!order || order.status !== "paid") {
    toast("E-tiket hanya tersedia untuk pesanan yang sudah dibayar.", "error");
    return;
  }
  if (!window.jspdf?.jsPDF) {
    fillPrintTicket(order);
    toast("Pustaka PDF belum termuat. Gunakan jendela cetak lalu pilih Simpan sebagai PDF.");
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const qr = await qrDataURL(order);
  const barcode = barcodeDataURL(ticketBarcodeValue(order));

  // Palet yang sama dengan e-tiket di web
  const GREEN_950 = [15, 53, 35];
  const GREEN_900 = [23, 69, 46];
  const GREEN_100 = [227, 238, 230];
  const GOLD = [201, 150, 46];
  const GOLD_SOFT = [231, 215, 182];
  const INK = [26, 31, 28];
  const MUTED = [102, 113, 104];
  const LINE = [216, 220, 210];
  const WHITE = [255, 255, 255];

  // Kartu tiket: x 15..195, y 18..152
  const X = 15, Y = 18, W = 180, H = 134, R = 4;
  const STUB_X = X + 122;
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...LINE);
  doc.roundedRect(X, Y, W, H, R, R, "FD");

  // Kepala kartu hijau (sudut atas bulat, bawah lurus) + garis emas
  doc.setFillColor(...GREEN_900);
  doc.roundedRect(X, Y, W, 32, R, R, "F");
  doc.rect(X, Y + 16, W, 16, "F");
  doc.setFillColor(...GOLD);
  doc.rect(X, Y + 32, W, 1.4, "F");

  doc.setTextColor(...GOLD_SOFT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("E - T I K E T", X + 8, Y + 10);
  doc.setTextColor(...WHITE);
  doc.setFontSize(17);
  doc.text("TMII Tiket", X + 8, Y + 19);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Kode pesanan ${order.code}`, X + 8, Y + 27);

  // Lencana status di kanan kepala kartu
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const statusText = "Sudah dibayar";
  const statusW = doc.getTextWidth(statusText) + 10;
  doc.setFillColor(...WHITE);
  doc.roundedRect(X + W - statusW - 8, Y + 10, statusW, 9, 4.5, 4.5, "F");
  doc.setTextColor(...GREEN_900);
  doc.text(statusText, X + W - statusW - 3, Y + 16.2);

  // Isi kiri: judul tiket
  const title = order.items
    .map((item) => `${item.qty} x ${ticketById(item.id)?.name || item.id}`)
    .join(" dan ");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const titleLines = doc.splitTextToSize(title, 106);
  doc.text(titleLines.slice(0, 2), X + 8, Y + 44);

  // Lencana ringkas: tanggal, pengunjung, total
  const chips = [
    { text: formatVisitDate(order.date), fill: GREEN_100, color: GREEN_950 },
    { text: visitorsText(order), fill: GREEN_100, color: GREEN_950 },
    { text: `Total ${formatIDR(orderTotal(order))}`, fill: GOLD_SOFT, color: INK },
  ];
  doc.setFontSize(8.5);
  let chipX = X + 8;
  let chipY = Y + 56;
  chips.forEach((chip) => {
    const w = doc.getTextWidth(chip.text) + 8;
    if (chipX + w > STUB_X - 4) {
      chipX = X + 8;
      chipY += 10;
    }
    doc.setFillColor(...chip.fill);
    doc.roundedRect(chipX, chipY, w, 7.5, 3.75, 3.75, "F");
    doc.setTextColor(...chip.color);
    doc.setFont("helvetica", "bold");
    doc.text(chip.text, chipX + 4, chipY + 5.2);
    chipX += w + 3;
  });

  // Rincian dua kolom
  const cells = [
    ["Tanggal kunjungan", formatVisitDate(order.date)],
    ["Jumlah pengunjung", visitorsText(order)],
    ["Nama pemesan", order.buyer.name],
    ["Email tujuan e-tiket", order.buyer.email],
    ["Total dibayar", formatIDR(orderTotal(order))],
    ["Status email", order.emailStatus],
  ];
  const colX = [X + 8, X + 62];
  let cellY = Y + 78;
  cells.forEach(([label, value], index) => {
    const x = colX[index % 2];
    if (index % 2 === 0 && index > 0) cellY += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, cellY);
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const valueLines = doc.splitTextToSize(String(value), 50);
    doc.text(valueLines.slice(0, 2), x, cellY + 5.5);
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Tunjukkan QR atau barcode ini di gerbang masuk. Petugas akan memindainya satu kali.", X + 8, Y + H - 7, { maxWidth: 106 });

  // Garis sobek + takik lingkaran
  doc.setDrawColor(...LINE);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(STUB_X, Y + 36, STUB_X, Y + H - 4);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(...WHITE);
  doc.circle(STUB_X, Y, 4, "F");
  doc.circle(STUB_X, Y + H, 4, "F");

  // Sobekan kanan: QR, kode, barcode
  const stubCenter = STUB_X + (X + W - STUB_X) / 2;
  if (qr) {
    doc.setDrawColor(...LINE);
    doc.roundedRect(stubCenter - 21, Y + 42, 42, 42, 3, 3, "D");
    doc.addImage(qr, "PNG", stubCenter - 19.5, Y + 43.5, 39, 39);
  }
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(order.code, stubCenter, Y + 94, { align: "center" });
  if (barcode) doc.addImage(barcode, "PNG", stubCenter - 21, Y + 99, 42, 11);
  if (order.ticket?.id) {
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text(order.ticket.id, stubCenter, Y + 114, { align: "center", maxWidth: 52 });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("Satu QR dan barcode untuk pesanan ini.", stubCenter, Y + 118, { align: "center", maxWidth: 52 });
  doc.text("Jangan dibagikan ke orang lain.", stubCenter, Y + 123, { align: "center", maxWidth: 52 });

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Dokumen contoh dari mockup TMII Tiket. Harga dan pesanan bukan data resmi TMII.", X, Y + H + 10, { maxWidth: 180 });
  doc.save(`E-Tiket-${order.code}.pdf`);
  toast("PDF e-tiket berhasil diunduh.");
}

export function fillPrintTicket(order) {
  const section = document.querySelector("#print-ticket");
  if (!section) return;
  section.innerHTML = `
    <h1>E-Tiket TMII</h1>
    <dl>
      <div><dt>Kode pesanan</dt><dd>${escapeHTML(order.code)}</dd></div>
      <div><dt>Tanggal kunjungan</dt><dd>${formatVisitDate(order.date)}</dd></div>
      <div><dt>Pengunjung</dt><dd>${visitorsText(order)}</dd></div>
      <div><dt>Nama pemesan</dt><dd>${escapeHTML(order.buyer.name)}</dd></div>
    </dl>
    <p>Tunjukkan halaman e-tiket ini di gerbang masuk.</p>`;
}

export function renderTicket(order) {
  if (!order) return "";
  if (order.status !== "paid") {
    return `
    <div class="container">
      <div class="page-head"><h1>E-tiket belum tersedia</h1><p>Pesanan ${escapeHTML(order.code)} belum selesai dibayar.</p></div>
      <div class="card empty-state">
        <h3>Selesaikan pembayaran dulu</h3>
        <p>Setelah pembayaran berhasil, e-tiket muncul di halaman ini dan salinannya otomatis dikirim ke email pemesan.</p>
        <button class="btn btn-accent" type="button" data-action="pay-order" data-code="${order.code}">Bayar sekarang</button>
      </div>
    </div>`;
  }

  return `
  <div class="container">
    <article class="card ticket-sheet" id="ticket-sheet">
      <header class="ticket-banner">
        <div>
          <span class="ticket-kicker">E-Tiket</span>
          <h1>TMII Tiket</h1>
          <p style="margin:4px 0 0">Kode pesanan <strong>${escapeHTML(order.code)}</strong>${order.isExample ? " (contoh)" : ""}</p>
        </div>
        <span class="status-tag status-paid">Sudah dibayar</span>
      </header>
      <div class="ticket-body">
        <div>
          <h2>${escapeHTML(order.items.map((item) => `${item.qty} x ${ticketById(item.id)?.name || item.id}`).join(" dan "))}</h2>
          <div class="ticket-chips">
            <span class="ticket-chip">${formatVisitDate(order.date)}</span>
            <span class="ticket-chip">${visitorsText(order)}</span>
            <span class="ticket-chip ticket-chip-total">Total ${formatIDR(orderTotal(order))}</span>
          </div>
          <dl>
            <div><dt>Tanggal kunjungan</dt><dd>${formatVisitDate(order.date)}</dd></div>
            <div><dt>Jumlah pengunjung</dt><dd>${visitorsText(order)}</dd></div>
            <div><dt>Nama pemesan</dt><dd>${escapeHTML(order.buyer.name)}</dd></div>
            <div><dt>Email tujuan e-tiket</dt><dd>${escapeHTML(order.buyer.email)}</dd></div>
            <div><dt>Total dibayar</dt><dd>${formatIDR(orderTotal(order))}</dd></div>
            <div><dt>Status email</dt><dd>${escapeHTML(order.emailStatus)}</dd></div>
          </dl>
          <p class="muted">Tunjukkan QR atau barcode ini di gerbang masuk. Petugas akan memindainya satu kali.</p>
          <div class="ticket-actions">
            <button class="btn btn-accent" type="button" data-action="download-pdf" data-code="${order.code}">Unduh PDF</button>
            <button class="btn btn-outline" type="button" data-action="resend-email" data-code="${order.code}">Kirim ulang ke email</button>
          </div>
          <p class="small muted">File PDF bisa disimpan di ponsel atau dicetak. Kalau email belum masuk, periksa folder spam dulu, lalu pakai tombol kirim ulang.</p>
        </div>
        <aside class="qr-box" aria-label="Kode QR dan barcode e-tiket">
          <div class="qr-frame">
            <img id="ticket-qr" alt="Kode QR untuk pesanan ${escapeHTML(order.code)}">
          </div>
          <code class="ticket-code">${escapeHTML(order.code)}</code>
          <svg id="ticket-barcode" class="ticket-barcode" role="img" aria-label="Barcode untuk pesanan ${escapeHTML(order.code)}"></svg>
          ${order.ticket ? `<p class="ticket-id">ID tiket<br><code>${escapeHTML(order.ticket.id)}</code></p>
          <div class="qr-rotate">
            <div class="qr-rotate-bar"><i id="qr-rotate-fill"></i></div>
            <p class="small muted">Kode QR berganti tiap 30 detik, jadi tangkapan layar cepat kedaluwarsa.<br>Jam perangkat: <span data-live-clock>--:--:--</span></p>
          </div>` : ""}
          <p class="small muted">Satu QR dan barcode untuk pesanan ini. Jangan dibagikan ke orang lain.</p>
        </aside>
      </div>
    </article>
  </div>`;
}

export async function mountTicket(order) {
  const image = document.querySelector("#ticket-qr");
  if (!order || !image) return;
  const qr = await qrDataURL(order);
  if (qr) image.src = qr;
  else {
    image.alt = `Kode pesanan ${order.code}. Pustaka QR belum termuat.`;
    image.style.display = "none";
  }
  const barcode = document.querySelector("#ticket-barcode");
  if (barcode) {
    if (window.JsBarcode) {
      try {
        window.JsBarcode(barcode, ticketBarcodeValue(order), {
          format: "CODE128",
          width: 2,
          height: 46,
          displayValue: false,
          margin: 0,
          background: "transparent",
        });
      } catch {
        barcode.style.display = "none";
      }
    } else {
      barcode.style.display = "none";
    }
  }
  fillPrintTicket(order);
}

function barcodeDataURL(code) {
  if (!window.JsBarcode) return "";
  try {
    const canvas = document.createElement("canvas");
    window.JsBarcode(canvas, code, {
      format: "CODE128",
      width: 2,
      height: 46,
      displayValue: false,
      margin: 0,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
