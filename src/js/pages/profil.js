import { qs } from "../utils.js";
import { renderProfile, requireUser } from "./account.js";
if (requireUser()) qs("#main").innerHTML = renderProfile();
