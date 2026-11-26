import { getCart, setCart } from "../store.js";
import { qs } from "../utils.js";

const cart = getCart();
const category = qs("#ticket-category");
if (category) category.value = cart.category || "semua";

qs("#booking-search")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  setCart({
    category: String(data.get("category") || "semua"),
  });
  window.location.href = "tiket.html";
});

// Pita nama provinsi: menunjukkan luasnya budaya yang dirangkum TMII,
// bergerak pelan dan berhenti saat diarahkan kursor.
const heroSection = qs(".hero");
if (heroSection) {
  const provinces = [
    "Aceh", "Sumatera Utara", "Sumatera Barat", "Riau", "Kepulauan Riau",
    "Jambi", "Sumatera Selatan", "Kepulauan Bangka Belitung", "Bengkulu",
    "Lampung", "Banten", "DKI Jakarta", "Jawa Barat", "Jawa Tengah",
    "DI Yogyakarta", "Jawa Timur", "Bali", "Nusa Tenggara Barat",
    "Nusa Tenggara Timur", "Kalimantan Barat", "Kalimantan Tengah",
    "Kalimantan Selatan", "Kalimantan Timur", "Kalimantan Utara",
    "Sulawesi Utara", "Gorontalo", "Sulawesi Tengah", "Sulawesi Barat",
    "Sulawesi Selatan", "Sulawesi Tenggara", "Maluku", "Maluku Utara",
    "Papua Barat", "Papua Barat Daya", "Papua", "Papua Tengah",
    "Papua Pegunungan", "Papua Selatan",
  ];
  const track = provinces.map((name) => `<span>${name}</span>`).join("");
  const ribbon = document.createElement("div");
  ribbon.className = "province-ribbon";
  ribbon.setAttribute("aria-label", "Provinsi-provinsi yang anjungannya ada di TMII");
  ribbon.innerHTML = `<div class="ribbon-track" aria-hidden="true">${track}${track}</div>`;
  heroSection.after(ribbon);
}
