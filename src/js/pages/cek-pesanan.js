import { qs } from "../utils.js";
import { mountLookup, renderLookup } from "./lookup.js";
qs("#main").innerHTML = renderLookup();
mountLookup();
