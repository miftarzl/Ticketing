import { qs } from "../utils.js";
import { mountCheckout, renderCheckoutPage } from "./booking.js";
const root = qs("#main");
root.innerHTML = renderCheckoutPage();
mountCheckout(root);
