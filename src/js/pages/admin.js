import { currentUser, hasPermission, setSessionArea } from "../store.js";
import { mountAdminPanel, showDisguised404 } from "./panel-core.js";

setSessionArea("admin");
const user = currentUser();

// Halaman ini khusus Super Admin. Peran lain yang berizin panel diarahkan
// ke halamannya sendiri; yang tidak berhak hanya melihat 404 samaran.
if (!user) {
  window.location.replace("admin-login.html");
  throw new Error("Mengalihkan ke halaman masuk admin");
}
if (user.role !== "superadmin") {
  if (hasPermission("dashboard")) {
    window.location.replace("panel.html");
    throw new Error("Mengalihkan ke panel admin");
  }
  showDisguised404();
  throw new Error("404");
}
document.title = "Super Admin - TMII Tiket";
mountAdminPanel();
