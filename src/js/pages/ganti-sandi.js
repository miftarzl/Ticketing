import { api, currentUser, hasPermission, refreshSessionUser, setSessionArea } from "../store.js";
import { qs, sha256, toast } from "../utils.js";

setSessionArea("admin");

const user = currentUser();
if (!user) {
  window.location.replace("admin-login.html");
  throw new Error("Belum masuk sebagai pengelola");
}

function homeForArea() {
  if (user.role === "superadmin") return "admin.html";
  if (hasPermission("dashboard")) return "panel.html";
  if (hasPermission("scan")) return "scan.html";
  return "admin-login.html";
}

qs("#change-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const password = String(data.get("password") || "");
  const confirm = String(data.get("confirm") || "");
  if (password.length < 6) {
    toast("Kata sandi minimal 6 karakter.", "error");
    form.querySelector("#change-password").focus();
    return;
  }
  if (password !== confirm) {
    toast("Pengulangan kata sandi belum sama.", "error");
    form.querySelector("#change-confirm").focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/password/change", { method: "POST", body: { passwordHash: await sha256(password) } });
    await refreshSessionUser();
    toast("Kata sandi baru tersimpan. Selamat bekerja lagi.");
    window.location.href = homeForArea();
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
});
