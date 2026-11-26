import { currentUser, endSession, hasPermission, loginAccount, setSessionArea } from "../store.js";
import { qs, sha256, toast, validateEmail } from "../utils.js";

setSessionArea("admin");

// Setiap peran pengelola punya halamannya sendiri: Super Admin ke
// admin.html, Admin ke panel.html, Scanner ke halaman pindai.
function homeForArea() {
  const user = currentUser();
  if (!user) return null;
  // Akun yang sandinya baru direset Super Admin wajib membuat sandi
  // pribadi dulu sebelum masuk ke halaman perannya.
  if (user.mustChangePassword) return "ganti-sandi.html";
  if (user.role === "superadmin") return "admin.html";
  if (hasPermission("dashboard")) return "panel.html";
  if (hasPermission("scan")) return "scan.html";
  return null;
}

if (currentUser() && homeForArea()) {
  window.location.replace(homeForArea());
  throw new Error("Sudah masuk sebagai pengelola");
}

qs("#admin-login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim().toLowerCase();
  const password = String(data.get("password") || "");
  if (!validateEmail(email)) {
    toast("Periksa lagi alamat emailnya.", "error");
    form.querySelector("#admin-email").focus();
    return;
  }
  if (!password) {
    toast("Kata sandi belum diisi.", "error");
    return;
  }
  try {
    const user = await loginAccount({ email, passwordHash: await sha256(password) });
    const home = homeForArea();
    if (!home) {
      endSession();
      toast("Akun ini bukan akun pengelola.", "error");
      return;
    }
    toast(`Selamat datang, ${user.name}.`);
    window.location.href = home;
  } catch (error) {
    toast(error.message, "error");
  }
});
