import { currentUser, hasPermission, setSessionArea } from "../store.js";
import { mountRolesPage, showDisguised404 } from "./panel-core.js";

setSessionArea("admin");
const user = currentUser();

// Halaman khusus pengelola peran (izin roles.manage, misalnya Super Admin).
// Peran lain diarahkan ke halamannya sendiri; yang tidak berhak hanya
// melihat 404 samaran.
if (!user) {
  window.location.replace("admin-login.html");
  throw new Error("Mengalihkan ke halaman masuk admin");
}
if (!hasPermission("roles.manage")) {
  if (hasPermission("dashboard")) {
    window.location.replace(user.role === "superadmin" ? "admin.html" : "panel.html");
    throw new Error("Mengalihkan ke panel");
  }
  showDisguised404();
  throw new Error("404");
}
document.title = "Peran dan Akun - TMII Tiket";
mountRolesPage();
