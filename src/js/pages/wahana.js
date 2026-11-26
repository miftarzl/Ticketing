import { WAHANA } from "../data.js";
import { escapeHTML, qs } from "../utils.js";

// Kartu wahana dari data WAHANA (data.js). Klik foto atau kartu membuka
// dialog berisi foto besar dan penjelasan wahana itu.
const grid = qs("[data-wahana]");
const dialog = qs("#wahana-dialog");

function openDetail(w) {
  if (!dialog) return;
  dialog.innerHTML = `
    <img class="wahana-dialog-img" src="${w.image}" alt="${escapeHTML(w.name)}" width="${w.width}" height="${w.height}">
    <div class="dialog-inner wahana-dialog-body">
      <span class="cat-chip">${escapeHTML(w.label)}</span>
      <h2 id="wahana-dialog-title">${escapeHTML(w.name)}</h2>
      <p>${escapeHTML(w.detail)}</p>
      <div class="dialog-actions">
        ${w.ticketId ? `<a class="btn btn-primary" href="tiket.html">Lihat tiketnya</a>` : ""}
        <button class="btn btn-ghost" type="button" data-close-dialog>Tutup</button>
      </div>
    </div>`;
  dialog.classList.add(`cat-${w.color}`);
  dialog.showModal();
  dialog
    .querySelector("[data-close-dialog]")
    ?.addEventListener("click", () => dialog.close());
}

if (grid) {
  grid.innerHTML = WAHANA.map(
    (w, i) => `
      <article class="card wahana-card cat-${w.color}" data-wahana-open="${i}" tabindex="0" role="button" aria-label="Lihat foto dan penjelasan ${escapeHTML(w.name)}">
        <img src="${w.image}" alt="${escapeHTML(w.name)}" width="${w.width}" height="${w.height}" loading="lazy">
        <div class="wahana-body">
          <span class="cat-chip">${escapeHTML(w.label)}</span>
          <h3>${escapeHTML(w.name)}</h3>
          <p>${escapeHTML(w.text)}</p>
          <span class="wahana-open-label">Lihat foto dan penjelasan</span>
        </div>
      </article>`
  ).join("");

  grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-wahana-open]");
    if (card) openDetail(WAHANA[Number(card.dataset.wahanaOpen)]);
  });
  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-wahana-open]");
    if (card) {
      event.preventDefault();
      openDetail(WAHANA[Number(card.dataset.wahanaOpen)]);
    }
  });
}

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog?.addEventListener("close", () => {
  dialog.className = "dialog wahana-dialog";
});
