import { toast } from "../utils.js";
import { mountLogin } from "./account.js";

if (sessionStorage.getItem("tmii-login-notice")) {
  sessionStorage.removeItem("tmii-login-notice");
  toast("Masuk atau daftar dulu untuk melihat tiket.", "error");
}
mountLogin();
