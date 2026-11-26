import { qs } from "../utils.js";
import { ACCOUNTS_ENABLED } from "../store.js";
import { loadOrdersPage, mountOrdersPage, requireUser } from "./account.js";
// Dalam mode tamu halaman ini disembunyikan: pengunjung melacak pesanan
// lewat Cek Pesanan (kode + kontak), bukan daftar milik akun.
if (!ACCOUNTS_ENABLED) {
  window.location.replace("cek-pesanan.html");
  throw new Error("Mode tamu: mengalihkan ke Cek Pesanan");
}
if (requireUser()) {
  const root = qs("#main");
  mountOrdersPage(root);
  loadOrdersPage(root);
}
