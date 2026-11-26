import {
  closePaymentDialog,
  openGatewayPayment,
  renderFooter,
  renderHeader,
} from "./components.js";
import { PAYMENT_METHODS, ticketById } from "./data.js";
import {
  ACCOUNTS_ENABLED,
  addTicketToCart,
  cancelOrderByCode,
  clearCart,
  currentUser,
  endSession,
  cartEntries,
  fetchOrder,
  payOrder,
  removeTicketFromCart,
  resendTicketEmail,
} from "./store.js";
import { qs, toast } from "./utils.js";
import { downloadTicketPDF } from "./pages/ticket.js";

const activePage = document.body.dataset.page || "";
qs("#site-header").innerHTML = renderHeader(activePage);
qs("#site-footer").innerHTML = renderFooter();

document.addEventListener("click", async (event) => {
  const tiketLink = event.target.closest('a[href="tiket.html"]');
  if (tiketLink && ACCOUNTS_ENABLED && !currentUser()) {
    event.preventDefault();
    sessionStorage.setItem("tmii-login-notice", "1");
    window.location.href = "masuk.html";
    return;
  }

  const profileToggle = event.target.closest('[data-action="profile-toggle"]');
  if (profileToggle) {
    const menu = qs("[data-profile-menu]");
    const open = menu.hidden;
    menu.hidden = !open;
    profileToggle.setAttribute("aria-expanded", String(open));
    return;
  }
  if (!event.target.closest(".profile-wrap")) {
    const menu = qs("[data-profile-menu]");
    if (menu) menu.hidden = true;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  if (action === "mobile-toggle") {
    const panel = qs("[data-mobile-panel]");
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    actionButton.setAttribute("aria-expanded", String(open));
  }

  if (action === "logout") {
    endSession();
    toast("Kamu sudah keluar.");
    window.location.href = "index.html";
  }

  if (action === "add-ticket") {
    // Paket Paspor Keluarga sudah berisi semua tiket, jadi tidak boleh
    // dicampur tiket lain di pesanan yang sama.
    const ticket = ticketById(actionButton.dataset.id);
    const entries = cartEntries();
    const hasPackage = entries.some((entry) => entry.ticket.category === "paket");
    const hasPerPerson = entries.some((entry) => entry.ticket.perPerson);
    if (ticket?.category === "paket" && hasPerPerson) {
      toast("Paket Paspor Keluarga sudah mencakup semua tiket. Hapus tiket lain dulu ya.", "error");
      return;
    }
    if (ticket?.perPerson && hasPackage) {
      toast("Pesananmu sudah berisi Paket Paspor Keluarga yang mencakup semua tiket.", "error");
      return;
    }
    addTicketToCart(actionButton.dataset.id);
    toast("Tiket ditambahkan ke pesanan.");
    document.dispatchEvent(new CustomEvent("cart-changed"));
  }

  if (action === "remove-ticket") {
    removeTicketFromCart(actionButton.dataset.id);
    toast("Tiket dihapus dari pesanan.");
    document.dispatchEvent(new CustomEvent("cart-changed"));
  }

  if (action === "pay-order") {
    try {
      const order = await fetchOrder(actionButton.dataset.code);
      const method = PAYMENT_METHODS.find((item) => item.id === order.paymentMethod);
      openGatewayPayment(order, method?.name || "Pembayaran");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  if (action === "cancel-order") {
    if (actionButton.dataset.confirm === "true") {
      try {
        await cancelOrderByCode(actionButton.dataset.code);
        toast("Pesanan dibatalkan.");
        document.dispatchEvent(new CustomEvent("orders-changed"));
      } catch (error) {
        toast(error.message, "error");
      }
    } else {
      actionButton.dataset.confirm = "true";
      actionButton.textContent = "Klik lagi untuk membatalkan";
      window.setTimeout(() => {
        if (actionButton.isConnected) {
          actionButton.dataset.confirm = "false";
          actionButton.textContent = "Batalkan pesanan";
        }
      }, 3000);
    }
  }

  if (action === "close-dialog") closePaymentDialog();

  if (action === "confirm-payment") {
    const code = actionButton.dataset.code;
    actionButton.disabled = true;
    actionButton.textContent = "Memproses pembayaran...";
    try {
      const order = await payOrder(code);
      closePaymentDialog();
      clearCart();
      sessionStorage.setItem("tmii-success-once", order.code);
      window.location.href = `pembayaran-berhasil.html?kode=${order.code}`;
    } catch (error) {
      closePaymentDialog();
      toast(error.message, "error");
    }
  }

  if (action === "download-pdf") {
    await downloadTicketPDF(actionButton.dataset.code);
  }

  if (action === "resend-email") {
    actionButton.disabled = true;
    try {
      const order = await resendTicketEmail(actionButton.dataset.code);
      toast(`E-tiket dikirim ulang ke ${order.buyer.email}. Cek kotak masuk atau folder spam.`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      actionButton.disabled = false;
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const menu = qs("[data-profile-menu]");
    if (menu) menu.hidden = true;
    qs("[data-mobile-panel]")?.classList.remove("open");
  }
});

// ---------- Hitung mundur batas pembayaran (10 menit) ----------
let countdownReloadScheduled = false;
function tickCountdowns() {
  const nodes = document.querySelectorAll("[data-countdown]");
  if (!nodes.length) return;
  let anyExpired = false;
  nodes.forEach((node) => {
    const target = new Date(node.dataset.countdown).getTime();
    const left = target - Date.now();
    if (Number.isNaN(target) || left <= 0) {
      node.textContent = "00:00";
      anyExpired = true;
      return;
    }
    if (left < 60000) node.closest(".pay-countdown, .summary-row")?.classList.add("countdown-urgent");
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    node.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  });
  if (anyExpired && !countdownReloadScheduled) {
    countdownReloadScheduled = true;
    toast("Batas waktu pembayaran 10 menit habis. Pesanan dibatalkan otomatis.");
    window.setTimeout(() => window.location.reload(), 1800);
  }
}
tickCountdowns();
setInterval(tickCountdowns, 1000);

// ---------- Efek muncul saat digulir ----------
// Elemen masuk sekali saat pertama terlihat di layar, memandu urutan baca.
const revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("in");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1 }
      )
    : null;

function tagReveals() {
  const candidates = document.querySelectorAll(
    ".section-head, .card, .ticket-flagship, .ticket-row, .order-card, .success-card"
  );
  candidates.forEach((el, index) => {
    if (el.classList.contains("reveal")) return;
    el.classList.add("reveal");
    el.style.transitionDelay = `${(index % 4) * 60}ms`;
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add("in");
  });
}
tagReveals();
new MutationObserver(() => tagReveals()).observe(document.body, {
  childList: true,
  subtree: true,
});
