import { currentUser, endSession, fetchScanLogs, hasPermission, setSessionArea, validateTicket } from "../store.js";
import { escapeHTML, qs, toast } from "../utils.js";

setSessionArea("admin");
const user = currentUser();

// Halaman petugas: hanya peran berizin pindai yang boleh membuka,
// selain itu disamarkan sebagai 404
if (!user) {
  window.location.replace("admin-login.html");
  throw new Error("Mengalihkan ke halaman masuk admin");
}
if (!hasPermission("scan")) {
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
  throw new Error("404");
}
document.title = "Pindai Tiket - TMII Tiket";

// Kepala halaman: tautan kembali ke panel admin hanya untuk super admin.
// Peran lain (scanner, admin, peran kustom) mendapat menu profil dengan
// desain yang sama persis seperti menu profil pengguna di situs utama
// (kelas .profile-wrap/.profile-button/.profile-menu dari layout.css).
const ROLE_LABELS = {
  superadmin: "Super Admin",
  admin: "Admin",
  scanner: "Scanner",
  manajer: "Manajer",
  "cs-loket": "Customer Service",
  "scanner-cadangan": "Scanner Cadangan",
  user: "Pengguna",
};
const headAction = qs("#scan-head-action");
if (headAction) {
  if (user.role === "superadmin") {
    headAction.innerHTML = `<a href="admin.html">Kembali ke panel admin</a>`;
  } else {
    const roleLabel = ROLE_LABELS[user.role] || user.role;
    headAction.innerHTML = `
      <div class="profile-wrap">
        <button class="profile-button" type="button" id="profile-trigger" aria-expanded="false" aria-haspopup="true">
          <span class="avatar" aria-hidden="true">${escapeHTML((user.name || "?").trim().charAt(0).toUpperCase())}</span>
          <span>${escapeHTML(user.name)}</span>
        </button>
        <div class="profile-menu" id="profile-dropdown" hidden>
          <p><strong>${escapeHTML(user.name)}</strong><br><span class="small muted">${escapeHTML(user.email)}</span><br><span class="small muted">Peran: ${escapeHTML(roleLabel)}</span></p>
          <button type="button" class="logout" id="scan-logout">Keluar</button>
        </div>
      </div>`;
    const trigger = qs("#profile-trigger");
    const dropdown = qs("#profile-dropdown");
    if (trigger && dropdown) {
      const closeMenu = () => {
        dropdown.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      };
      trigger.addEventListener("click", () => {
        const willOpen = dropdown.hidden;
        dropdown.hidden = !willOpen;
        trigger.setAttribute("aria-expanded", String(willOpen));
      });
      document.addEventListener("click", (event) => {
        if (!event.target.closest(".profile-wrap")) closeMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
      });
    }
  }
}
const scanLogoutBtn = qs("#scan-logout");
if (scanLogoutBtn) {
  scanLogoutBtn.addEventListener("click", () => {
    endSession();
    window.location.replace("admin-login.html");
  });
}

const deviceInput = qs("#scan-device");
deviceInput.value = localStorage.getItem("tmii-scanner-id") || user.name || "gerbang-1";
deviceInput.addEventListener("change", () => {
  localStorage.setItem("tmii-scanner-id", deviceInput.value.trim() || user.name || "gerbang-1");
});

// Log pemindaian hanya untuk peran berizin melihat log (pemantau);
// akun scanner murni tidak menampilkannya sama sekali.
const canSeeLogs = hasPermission("logs");
if (!canSeeLogs) qs("#scan-logs")?.closest("section")?.remove();

let scanLogRows = null;
let logQuery = "";
let logFilter = "";
const logSearchInput = qs("#scan-log-search");
if (logSearchInput) {
  logSearchInput.addEventListener("input", () => {
    logQuery = logSearchInput.value;
    paintLogs();
  });
}
const logFilterSelect = qs("#scan-log-filter");
if (logFilterSelect) {
  logFilterSelect.addEventListener("change", () => {
    logFilter = logFilterSelect.value;
    paintLogs();
  });
}

function logMatches(log, q) {
  const haystack = [
    new Date(log.created_at).toLocaleString("id-ID"),
    log.result === "success" ? "Berhasil" : "Ditolak",
    log.order_code || "",
    log.reason || "",
    log.scanner_id || "",
    log.officer_email || "",
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

function paintLogs() {
  const wrap = qs("#scan-logs");
  if (!wrap || !scanLogRows) return;
  if (!scanLogRows.length) {
    wrap.innerHTML = `<p class="muted">Belum ada pemindaian tercatat.</p>`;
    return;
  }
  const q = logQuery.trim().toLowerCase();
  let rows = scanLogRows;
  if (logFilter) rows = rows.filter((log) => log.result === logFilter);
  if (q) rows = rows.filter((log) => logMatches(log, q));
  if (!rows.length) {
    wrap.innerHTML = `<p class="muted">Tidak ada log yang cocok dengan ${q ? `pencarian "${escapeHTML(logQuery.trim())}"` : "filter yang dipilih"}.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Waktu</th><th>Hasil</th><th>Pesanan</th><th>Alasan / keterangan</th><th>Perangkat</th><th>Petugas</th></tr></thead>
        <tbody>
          ${rows.map((log) => `
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

async function renderLogs() {
  if (!canSeeLogs) return;
  const wrap = qs("#scan-logs");
  if (!wrap) return;
  try {
    scanLogRows = await fetchScanLogs();
    paintLogs();
  } catch (error) {
    wrap.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}

// Bunyi penanda hasil pindai, dibuat langsung dari WebAudio (tanpa berkas suara):
// petugas di gerbang tidak harus menatap layar untuk tahu hasilnya.
let audioCtx = null;
// Browser menahan suara sampai halaman disentuh pengguna, jadi konteks
// suara disiapkan sejak klik pertama di halaman ini.
function primeAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    // Suara hanya pelengkap
  }
}
document.addEventListener("pointerdown", primeAudio);

function playScanSound(ok) {
  try {
    primeAudio();
    if (!audioCtx) return;
    const start = audioCtx.currentTime;
    const notes = ok
      ? [[880, 0, 0.12], [1318, 0.13, 0.22]]
      : [[330, 0, 0.16], [262, 0.2, 0.28]];
    for (const [freq, offset, dur] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.32, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + dur + 0.05);
    }
  } catch {
    // Suara hanya pelengkap, abaikan bila browser menolak
  }
}

let validating = false;
async function runValidation({ token = "", ticketId = "" }) {
  if (validating) return;
  if (!token && !ticketId) {
    toast("Isi token QR atau ID tiket dulu.", "error");
    return;
  }
  validating = true;
  try {
    const result = await validateTicket({
      ...(token ? { token } : { ticketId }),
      scannerId: deviceInput.value.trim() || "web",
    });
    playScanSound(result.ok);
    const box = qs("#scan-result");
    box.hidden = false;
    box.classList.toggle("scan-result-ok", result.ok);
    box.classList.toggle("scan-result-fail", !result.ok);
    qs("#scan-message").textContent = result.message;
    qs("#scan-checks").innerHTML = result.checks
      .map((check) => `
        <li>
          <span class="mark ${check.ok ? "ok" : "fail"}">${check.ok ? "✓" : "✗"}</span>
          <span>${escapeHTML(check.label)}${check.detail ? `<small>${escapeHTML(check.detail)}</small>` : ""}</span>
        </li>`)
      .join("");
    qs("#scan-ticket-info").textContent = result.ticket
      ? `ID tiket ${result.ticket.id}, pesanan ${result.ticket.orderCode}, status sekarang: ${result.ticket.status}`
      : "";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    renderLogs();
  } catch (error) {
    playScanSound(false);
    toast(error.message, "error");
  } finally {
    validating = false;
  }
}

qs("#scan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  runValidation({
    token: String(data.get("token") || "").trim(),
    ticketId: String(data.get("ticketId") || "").trim(),
  });
});

// ---------- Pemindai kamera langsung ----------
// Dibangun langsung di atas kamera browser, tidak lewat perantara pustaka:
// mesin pertama BarcodeDetector bawaan Chrome (paling kuat membaca barcode
// dari siaran kamera), cadangannya ZXing yang membaca video terus-menerus.
const startButton = qs("#scanner-start");
const stopButton = qs("#scanner-stop");
const scannerStatus = qs("#scanner-status");
const readerEl = qs("#scanner-reader");
let cameraStream = null;
let decodeTimer = null;
let zxingReader = null;
let cameraOn = false;

function handleDecoded(text) {
  const value = String(text || "").trim();
  if (!value) return;
  stopCamera();
  // Token QR selalu berawalan T1.; hasil pindai barcode (UUID atau kode
  // pindai pendek) masuk ke pencarian tiket
  if (!value.startsWith("T1.")) {
    qs("#scan-ticket-id").value = value;
    qs("#scan-token").value = "";
    scannerStatus.textContent = "Barcode terbaca. Memvalidasi...";
    runValidation({ ticketId: value });
  } else {
    qs("#scan-token").value = value;
    qs("#scan-ticket-id").value = "";
    scannerStatus.textContent = "QR terbaca. Memvalidasi...";
    runValidation({ token: value });
  }
}

async function stopCamera() {
  if (decodeTimer) {
    clearInterval(decodeTimer);
    decodeTimer = null;
  }
  if (zxingReader) {
    try {
      zxingReader.reset();
    } catch {
      // Pembaca sudah berhenti
    }
    zxingReader = null;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  if (readerEl) readerEl.innerHTML = "";
  cameraOn = false;
  startButton.hidden = false;
  stopButton.hidden = true;
}

async function openCameraStream() {
  const attempts = [
    { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastError = new Error("Kamera tidak merespons");
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

startButton.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    scannerStatus.textContent = "Browser ini tidak memberi akses kamera. Buka halaman ini lewat localhost atau HTTPS di Chrome.";
    return;
  }
  startButton.disabled = true;
  scannerStatus.textContent = "Membuka kamera, tunggu sebentar. Kalau browser meminta izin kamera, klik Izinkan.";
  try {
    readerEl.innerHTML = "";
    const video = document.createElement("video");
    video.className = "scanner-video";
    video.playsInline = true;
    video.muted = true;
    readerEl.appendChild(video);

    if ("BarcodeDetector" in window) {
      cameraStream = await openCameraStream();
      video.srcObject = cameraStream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
      cameraOn = true;
      decodeTimer = setInterval(async () => {
        if (!cameraOn || video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length && codes[0].rawValue) handleDecoded(codes[0].rawValue);
        } catch {
          // Bingkai belum siap, coba lagi pada giliran berikutnya
        }
      }, 250);
      scannerStatus.textContent = "Kamera menyala, mesin detektor bawaan browser. Arahkan ke QR atau barcode e-tiket pengunjung.";
    } else if (window.jsQR || window.ZXing?.MultiFormatReader) {
      // Mesin video sendiri: ambil bingkai dari kamera lalu baca dari canvas.
      // jsQR membaca QR; inti ZXing membaca barcode dari data gambar yang
      // sama. Pembaca video bawaan ZXing tidak dipakai karena dia mematikan
      // siaran kamera setiap selesai membaca satu bingkai.
      cameraStream = await openCameraStream();
      video.srcObject = cameraStream;
      await video.play();
      cameraOn = true;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let coreReader = null;
      if (window.ZXing?.MultiFormatReader) {
        const hints = new Map();
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          window.ZXing.BarcodeFormat.QR_CODE,
          window.ZXing.BarcodeFormat.CODE_128,
        ]);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
        coreReader = new window.ZXing.MultiFormatReader();
        coreReader.setHints(hints);
      }
      let tick = 0;
      let tickBusy = false;
      decodeTimer = setInterval(async () => {
        if (!cameraOn || validating || tickBusy || video.readyState < 2 || !video.videoWidth) return;
        tickBusy = true;
        tick += 1;
        try {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (window.jsQR) {
            const found = window.jsQR(imageData.data, canvas.width, canvas.height);
            if (found?.data) {
              handleDecoded(found.data);
              return;
            }
          }
          if (coreReader && tick % 2 === 0) {
            try {
              const pixels = imageData.data;
              const gray = new Uint8ClampedArray(canvas.width * canvas.height);
              for (let i = 0, j = 0; i < pixels.length; i += 4, j += 1) {
                gray[j] = (pixels[i] + pixels[i + 1] * 2 + pixels[i + 2]) / 4;
              }
              const source = new window.ZXing.RGBLuminanceSource(gray, canvas.width, canvas.height);
              const bitmap = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(source));
              const result = coreReader.decode(bitmap);
              if (result?.getText()) handleDecoded(result.getText());
            } catch {
              // Belum ada kode pada bingkai ini
            } finally {
              try {
                coreReader.reset();
              } catch {
                // Abaikan
              }
            }
          }
        } catch {
          // Bingkai belum siap
        } finally {
          tickBusy = false;
        }
      }, 250);
      scannerStatus.textContent = "Kamera menyala, mesin pemindai video. Arahkan ke QR atau barcode e-tiket pengunjung.";
    } else {
      throw new Error("Tidak ada mesin pembaca kamera yang tersedia di browser ini");
    }
    startButton.hidden = true;
    stopButton.hidden = false;
  } catch (error) {
    await stopCamera();
    scannerStatus.textContent = `Kamera tidak bisa dibuka (${error?.name || error}). Cek izin kamera lewat ikon di kiri bilah alamat, dan pastikan tidak ada aplikasi lain (aplikasi Kamera, Zoom, Teams) yang sedang memakai kamera laptop.`;
    toast("Kamera tidak bisa dibuka. Sebabnya tertulis di bawah tombol kamera.", "error");
  } finally {
    startButton.disabled = false;
  }
});
stopButton.addEventListener("click", () => {
  stopCamera();
  scannerStatus.textContent = "Kamera mati.";
});

// Alternatif tanpa kamera: pindai dari berkas gambar (misalnya kiriman screenshot PDF).
// Berantai dari mesin terkuat: ZXing membaca pada resolusi asli gambar (barcode
// batang rusak kalau gambar diperkecil), lalu BarcodeDetector bawaan browser,
// lalu jsQR khusus QR, terakhir pemindai bawaan html5-qrcode.
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    if (window.ZXing?.BrowserMultiFormatReader) {
      try {
        const hints = new Map();
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          window.ZXing.BarcodeFormat.QR_CODE,
          window.ZXing.BarcodeFormat.CODE_128,
        ]);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
        const reader = new window.ZXing.BrowserMultiFormatReader(hints);
        const result = await reader.decodeFromImageElement(img);
        if (result?.getText()) return result.getText();
      } catch {
        // Lanjut ke pembaca berikutnya
      }
    }
    if (window.BarcodeDetector) {
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
        const codes = await detector.detect(img);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        // Lanjut ke pembaca berikutnya
      }
    }
    if (window.jsQR) {
      try {
        const scale = Math.min(1, 2000 / img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (result?.data) return result.data;
      } catch {
        // Lanjut ke pembaca terakhir
      }
    }
    if (window.Html5Qrcode) {
      const reader = new window.Html5Qrcode("scanner-reader");
      return await reader.scanFile(file, false);
    }
    throw new Error("undecodable");
  } finally {
    URL.revokeObjectURL(url);
  }
}

qs("#scan-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await decodeImageFile(file);
    handleDecoded(text);
  } catch {
    toast("Tidak ada QR atau barcode yang terbaca di gambar itu. Coba gambar yang QR-nya besar dan memenuhi gambar ya.", "error");
  }
});

renderLogs();
