export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function formatIDR(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatVisitDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00+07:00`);
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function toast(message, type = "success") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast${type === "error" ? " error" : ""}`;
  item.textContent = message;
  region.appendChild(item);
  window.setTimeout(() => item.remove(), 4200);
}

export function setFieldError(input, message) {
  const field = input.closest(".field");
  if (!field) return;
  let error = field.querySelector(".error");
  if (!error) {
    error = document.createElement("span");
    error.className = "error";
    error.id = `${input.id}-error`;
    field.appendChild(error);
  }
  error.textContent = message || "";
  input.setAttribute("aria-invalid", message ? "true" : "false");
  if (message) input.setAttribute("aria-describedby", error.id);
  else input.removeAttribute("aria-describedby");
}

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateWhatsApp(value) {
  return /^08\d{8,13}$/.test(value.replace(/[\s-]/g, ""));
}

export async function sha256(text) {
  if (!window.crypto?.subtle) return `plain-demo-${text.length}`;
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function makeOrderCode(existingCodes = []) {
  let code;
  do {
    const random = Math.floor(1000 + Math.random() * 9000);
    code = `TMII-2026-${random}`;
  } while (existingCodes.includes(code));
  return code;
}

export function visitorsText(orderOrCart) {
  const adults = Number(orderOrCart.adults || 0);
  const children = Number(orderOrCart.children || 0);
  const parts = [];
  if (adults) parts.push(`${adults} dewasa`);
  if (children) parts.push(`${children} anak`);
  return parts.join(", ") || "0 pengunjung";
}

export function totalVisitors(orderOrCart) {
  return Number(orderOrCart.adults || 0) + Number(orderOrCart.children || 0);
}
