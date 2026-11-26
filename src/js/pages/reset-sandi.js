import { api } from "../store.js";
import { qs, sha256, toast } from "../utils.js";

const token = new URLSearchParams(window.location.search).get("token") || "";
const form = qs("#reset-form");
if (!token) {
  qs("#reset-invalid").hidden = false;
  if (form) form.hidden = true;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get("password") || "");
  const confirm = String(data.get("confirm") || "");
  if (password.length < 8) {
    toast("Kata sandi minimal 8 karakter.", "error");
    form.querySelector("#reset-password").focus();
    return;
  }
  if (password !== confirm) {
    toast("Pengulangan kata sandi belum sama.", "error");
    form.querySelector("#reset-confirm").focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/password/reset", { method: "POST", body: { token, passwordHash: await sha256(password) } });
    qs("#reset-done").hidden = false;
    form.hidden = true;
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
});
