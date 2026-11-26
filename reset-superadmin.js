// Skrip darurat: atur ulang kata sandi Super Admin langsung dari terminal,
// dipakai hanya bila semua akun Super Admin terkunci (jalur pemulihan di
// dokumen mekanisme lupa kata sandi). Tidak bisa diakses dari web.
//
// Pakai:  node reset-superadmin.js [sandi-baru]
// Tanpa argumen, sandi diatur ulang ke admin123. Server boleh menyala atau
// mati; skrip ini bekerja langsung pada berkas database.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EMAIL = "superadmin.nurdin@tmii.id";
const password = process.argv[2] || "admin123";
if (password.length < 6) {
  console.error("Kata sandi minimal 6 karakter.");
  process.exit(1);
}
const db = new DatabaseSync(join(ROOT, "data", "tmii.db"));
const hash = createHash("sha256").update(password).digest("hex");
const info = db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE email = ?").run(hash, EMAIL);
if (!info.changes) {
  console.error(`Akun ${EMAIL} tidak ditemukan di database.`);
  process.exit(1);
}
db.prepare("DELETE FROM sessions WHERE email = ?").run(EMAIL);
db.exec("CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_email TEXT NOT NULL, action TEXT NOT NULL, target_email TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
db.prepare("INSERT INTO activity_logs (actor_email, action, target_email, detail, created_at) VALUES ('terminal', 'reset-sandi', ?, 'Reset darurat Super Admin lewat skrip terminal', ?)")
  .run(EMAIL, new Date().toISOString());
console.log(`Kata sandi ${EMAIL} sudah diatur ulang dan semua sesinya diakhiri.`);
console.log("Masuk lewat admin-login.html dengan sandi baru itu, lalu ganti dengan sandi yang kuat.");
