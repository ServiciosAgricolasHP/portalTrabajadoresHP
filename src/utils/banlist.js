import { normalizeRut } from "./rutUtils.js";

// RUTs que NO pueden consultar su detalle desde el portal, aunque estén
// presentes en data.json. Para el usuario final se muestra el mismo mensaje
// que "no encontrado" — a propósito, para no exponer que la lista existe.
//
// Editar acá y volver a deployar para cambiar la lista.
const BANNED_RUTS = new Set(
  [
    "18708323-0",
    "17213370-3",
    "11596750-9",
    "16240618-3",
    "17213240-5",
    "18016874-5",
    "25664751-6",
  ].map(normalizeRut),
);

export function isBanned(rut) {
  return BANNED_RUTS.has(normalizeRut(rut));
}
