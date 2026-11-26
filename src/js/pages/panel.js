import { currentUser, hasPermission, setSessionArea } from "../store.js";
import { mountAdminPanel, showDisguised404 } from "./panel-core.js";

setSessionArea("admin");
const user = currentUser();

// Halaman ini khusus peran Admin (dan peran berizin panel lain selain
// Super Admin, yang punya halamannya sendiri di admin.html).
if (!user) {
  window.location.replace("admin-login.html");
  throw new Error("Mengalihkan ke halaman masuk admin");
}
if (user.role === "superadmin") {
  window.location.replace("admin.html");
  throw new Error("Mengalihkan ke panel super admin");
}
if (!hasPermission("dashboard")) {
  showDisguised404();
  throw new Error("404");
}
document.title = "Panel Admin - TMII Tiket";
mountAdminPanel();
