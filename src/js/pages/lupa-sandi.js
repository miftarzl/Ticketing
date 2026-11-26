import { api } from "../store.js";
import { qs, toast, validateEmail } from "../utils.js";

qs("#forgot-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = String(new FormData(form).get("email") || "").trim().toLowerCase();
  if (!validateEmail(email)) {
    toast("Periksa lagi alamat emailnya.", "error");
    form.querySelector("#forgot-email").focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await api("/api/password/forgot", { method: "POST", body: { email } });
    // Jawabannya selalu umum, sama untuk email terdaftar maupun tidak,
    // supaya halaman ini tidak membocorkan email mana yang punya akun.
    qs("#forgot-result").innerHTML = `<div class="alert alert-info" role="status">${result.message || "Jika email terdaftar, tautan reset telah dikirim."} Periksa juga folder spam. Sesudah kata sandi diganti, semua sesi akunmu yang sedang aktif akan diakhiri.</div>`;
    form.reset();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
