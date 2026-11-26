// Pengiriman e-tiket lewat email, sisi server, tanpa dependensi npm.
//
// Konfigurasi email, urutan prioritasnya:
//   1. Environment saat server dijalankan:
//        TMII_MAIL_USER  alamat Gmail pengirim, mis. iskycboy@gmail.com
//        TMII_MAIL_PASS  Kata Sandi Aplikasi Gmail (16 huruf, bukan sandi akun)
//        TMII_MAIL_HOST  bawaan smtp.gmail.com
//        TMII_MAIL_PORT  bawaan 465 (TLS langsung)
//   2. Berkas data/settings.json di folder proyek, bagian "mail" (diisi
//      sekali oleh pemilik lewat editor teks; folder data tidak disajikan
//      ke web): { "mail": { "user": "...", "pass": "..." }, ... }
// Bila keduanya kosong, email tidak dikirim dan status pesanan tetap
// "simulasi versi contoh" seperti sebelumnya.
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import qrcode from "./qrcode-generator.js";
import { SERVICE_FEE, ticketById } from "../js/data.js";

const SETTINGS_PATH = fileURLToPath(new URL("../../data/settings.json", import.meta.url));

function readSettingsFile() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    const mail = parsed && typeof parsed === "object" ? parsed.mail : null;
    return mail && typeof mail === "object" ? mail : {};
  } catch {
    return {};
  }
}

export function mailConfig() {
  const envUser = (process.env.TMII_MAIL_USER || "").trim();
  const envPass = (process.env.TMII_MAIL_PASS || "").replace(/\s+/g, "");
  const fromEnv = Boolean(envUser && envPass);
  const file = readSettingsFile();
  const user = fromEnv ? envUser : String(file.user || "").trim();
  const pass = fromEnv ? envPass : String(file.pass || "").replace(/\s+/g, "");
  const host = (process.env.TMII_MAIL_HOST || file.host || "smtp.gmail.com").trim();
  const port = Number(process.env.TMII_MAIL_PORT || file.port || 465);
  return { user, pass, host, port, source: user && pass ? (fromEnv ? "env" : "file") : null };
}

export function mailConfigured() {
  const config = mailConfig();
  return Boolean(config.user && config.pass);
}

const MAIL_FROM_NAME = "TMII Tiket";

// ---------- PNG sederhana (untuk gambar QR di email) ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // kedalaman bit
  ihdr[9] = 2; // warna RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function qrPNGBuffer(payload) {
  const qr = qrcode(0, "M");
  qr.addData(String(payload));
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const scale = 10;
  const size = (count + quiet * 2) * scale;
  const rgb = Buffer.alloc(size * size * 3, 255);
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const offset = (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) * 3;
          rgb[offset] = 0;
          rgb[offset + 1] = 0;
          rgb[offset + 2] = 0;
        }
      }
    }
  }
  return encodePNG(size, size, rgb);
}

// ---------- SMTP minimal ----------
function readResponse(socket, buffer) {
  return new Promise((resolve, reject) => {
    let data = buffer.rest || "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.split("\r\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (/^\d{3} /.test(lines[i])) {
          cleanup();
          buffer.rest = lines.slice(i + 1).join("\r\n");
          resolve({ code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join(" ") });
          return;
        }
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Server email tidak merespons (timeout)"));
    };
    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    }
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
  });
}

async function sendSMTP({ to, subject, text, html, png }) {
  const cfg = mailConfig();
  const socket = cfg.port === 465
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : netConnect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(20000);
  const buffer = {};
  const command = async (line, expect) => {
    if (line !== null) socket.write(`${line}\r\n`);
    const response = await readResponse(socket, buffer);
    if (expect && response.code !== expect) {
      throw new Error(`SMTP ${response.code}: ${response.text.slice(0, 120)}`);
    }
    return response;
  };
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    await command(null, 220);
    await command(`EHLO localhost`, 250);
    await command("AUTH LOGIN", 334);
    await command(Buffer.from(cfg.user).toString("base64"), 334);
    await command(Buffer.from(cfg.pass).toString("base64"), 235);
    await command(`MAIL FROM:<${cfg.user}>`, 250);
    await command(`RCPT TO:<${to}>`, 250);
    await command("DATA", 354);

    const boundary = `tmii-${Date.now().toString(36)}`;
    const subject64 = Buffer.from(subject, "utf8").toString("base64");
    const wrap64 = (buffer) => buffer.toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");
    const parts = [
      `From: "${MAIL_FROM_NAME}" <${cfg.user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${subject64}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
    ];
    // Lampiran QR hanya untuk email e-tiket; email biasa (misalnya reset
    // kata sandi) tidak membawa png dan tidak boleh gagal karenanya.
    if (png) {
      parts.push(
        `--${boundary}`,
        'Content-Type: image/png; name="qr-etiket.png"',
        "Content-Transfer-Encoding: base64",
        "Content-ID: <qr-etiket@tmii>",
        'Content-Disposition: inline; filename="qr-etiket.png"',
        "",
        wrap64(png),
      );
    }
    parts.push(`--${boundary}--`, "");
    const message = parts.join("\r\n");
    socket.write(message.replace(/^\./gm, ".."));
    socket.write("\r\n.\r\n");
    await command(null, 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

// ---------- Isi email e-tiket ----------
function formatTanggal(iso) {
  try {
    return new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return iso;
  }
}

function formatRupiah(n) {
  return `Rp ${Number(n || 0).toLocaleString("id-ID")}`;
}

// Kirim email biasa (dipakai tautan reset kata sandi). Mengembalikan
// status pengiriman dari lapisan SMTP.
export async function sendPlainEmail({ to, subject, text, html }) {
  return sendSMTP({ to, subject, text, html });
}

export async function sendTicketEmail(order) {
  const buyer = order.buyer || {};
  const items = (order.items || [])
    .map((item) => {
      const ticket = ticketById(item.id);
      return `${item.qty} x ${ticket ? ticket.name : item.id}`;
    })
    .join(", ");
  const pengunjung = `${order.adults} dewasa, ${order.children} anak`;
  const tanggal = formatTanggal(order.date);
  const subtotal = (order.items || []).reduce((sum, item) => {
    const ticket = ticketById(item.id);
    return sum + (ticket ? ticket.price * item.qty : 0);
  }, 0);
  const total = formatRupiah(subtotal + Number(order.serviceFee ?? SERVICE_FEE));
  const scanCode = order.ticket?.scanCode || "";
  const subject = `E-Tiket TMII ${order.code}, kunjungan ${tanggal}`;

  const text = [
    `Halo ${buyer.name},`,
    "",
    "Pembayaranmu sudah lunas. Ini e-tiket TMII kamu:",
    "",
    `Kode pesanan : ${order.code}`,
    `Tiket        : ${items}`,
    `Tanggal      : ${tanggal}`,
    `Pengunjung   : ${pengunjung}`,
    `Total bayar  : ${total}`,
    scanCode ? `Kode pindai  : ${scanCode}` : "",
    "",
    "Tunjukkan QR pada gambar terlampir di gerbang masuk. QR dan kode",
    "pindai di atas hanya berlaku satu kali, pada tanggal kunjungan.",
    "Jangan bagikan ke orang lain. Versi PDF e-tiket ini bisa diunduh",
    "dari situs TMII Tiket lewat menu Pesanan Saya atau Cek Pesanan.",
    "",
    "Sampai jumpa di TMII.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");

  const itemsHtml = order.items.map((item) => {
    const ticket = ticketById(item.id);
    const label = ticket ? ticket.name : item.id;
    const price = ticket ? ticket.price : 0;
    return `<tr><td style="padding:3px 0;font-size:15px;color:#22301F">${item.qty} x ${label}</td><td align="right" style="padding:3px 0;font-size:15px;color:#22301F">${formatRupiah(price * item.qty)}</td></tr>`;
  }).join("");
  const html = `
<body style="margin:0;padding:0;background:#F5EFE0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE0;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E3DCC8;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
  <tr>
    <td style="background:#17452E;padding:20px 24px">
      <div style="font-size:11px;letter-spacing:3px;color:#C99A2E;font-weight:bold">E-TIKET</div>
      <div style="font-size:24px;color:#FFFFFF;font-weight:bold;margin-top:4px">TMII Tiket</div>
      <div style="font-size:13px;color:#D8E4D2;margin-top:2px">Kode pesanan <b style="color:#FFFFFF">${order.code}</b></div>
    </td>
    <td style="background:#17452E;padding:20px 24px" align="right" valign="top">
      <span style="display:inline-block;background:#EAF3EC;color:#17452E;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px">Sudah dibayar</span>
    </td>
  </tr>
  <tr><td colspan="2" style="background:#C99A2E;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td colspan="2" style="padding:20px 24px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
  </td></tr>
  <tr><td colspan="2" style="padding:10px 24px 0">
    <span style="display:inline-block;background:#EAF3EC;color:#17452E;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;margin-right:6px">${tanggal}</span>
    <span style="display:inline-block;background:#EAF3EC;color:#17452E;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;margin-right:6px">${order.adults} dewasa, ${order.children} anak</span>
    <span style="display:inline-block;background:#FBF3DC;color:#7A5B12;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px">Total ${total}</span>
  </td></tr>
  <tr><td colspan="2" style="padding:16px 24px 20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#22301F">
      <tr><td style="padding:4px 0;color:#6B7263" width="45%">Tanggal kunjungan</td><td style="padding:4px 0"><b>${tanggal}</b></td></tr>
      <tr><td style="padding:4px 0;color:#6B7263">Jumlah pengunjung</td><td style="padding:4px 0"><b>${order.adults} dewasa, ${order.children} anak</b></td></tr>
      <tr><td style="padding:4px 0;color:#6B7263">Nama pemesan</td><td style="padding:4px 0"><b>${order.buyer.name}</b></td></tr>
      <tr><td style="padding:4px 0;color:#6B7263">Total dibayar</td><td style="padding:4px 0"><b>${total}</b></td></tr>
    </table>
  </td></tr>
  <tr><td colspan="2" style="background:#EFF5EC;border-top:2px dashed #B9CBB2;padding:22px 24px" align="center">
    <img src="cid:qr-etiket@tmii" width="190" height="190" alt="Kode QR e-tiket" style="display:block;background:#FFFFFF;padding:10px;border:1px solid #D9E2D2;border-radius:12px">
    <div style="font-size:16px;font-weight:bold;letter-spacing:2px;color:#22301F;margin-top:14px">${order.code}</div>
    <div style="font-size:12px;color:#6B7263;margin-top:8px">ID tiket<br><span style="font-family:monospace;font-size:11px;color:#22301F">${order.ticket?.id || "-"}</span></div>
    <div style="font-size:12px;color:#6B7263;margin-top:10px">Kode pindai cadangan<br><span style="font-family:monospace;font-size:16px;font-weight:bold;letter-spacing:3px;color:#22301F">${scanCode || "-"}</span></div>
  </td></tr>
  <tr><td colspan="2" style="padding:16px 24px 22px;font-size:13px;color:#6B7263;line-height:1.6">
    Tunjukkan kode QR ini di gerbang masuk. Tiket hanya berlaku pada tanggal kunjungan dan hanya bisa dipakai satu kali. Simpan email ini baik-baik; bila QR tidak terbaca, petugas bisa memakai kode pindai cadangan di atas. Versi PDF e-tiket ini juga bisa diunduh dari situs TMII Tiket, lewat menu Pesanan Saya atau halaman Cek Pesanan.
  </td></tr>
</table>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9AA08F;margin-top:12px">TMII Tiket, versi contoh untuk latihan. Harga dan data bukan data resmi TMII.</div>
</td></tr>
</table>
</body>`;

  const png = qrPNGBuffer(order.qrPayload || order.code);
  await sendSMTP({ to: buyer.email, subject, text, html, png });
}
