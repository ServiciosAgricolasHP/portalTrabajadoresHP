// RUT helpers — copia minimalista de adminAgrofrutos/src/utils/rutUtils.js
// Solo lo que el portal necesita: normalizar y formatear para mostrar.
// Si cambia el contrato en admin (RUTs extranjeros con sufijos distintos,
// reglas nuevas), refrescar este archivo.

// Sin puntos ni espacios, en mayúsculas y con guion antes del dígito
// verificador: es el id de la ficha que publica TeRRa.
export function normalizeRut(value) {
  if (!value) return "";
  const r = String(value).replace(/[.\s]/g, "").toUpperCase();
  if (r.length < 2 || r.includes("-")) return r;
  return `${r.slice(0, -1)}-${r.slice(-1)}`;
}

export function formatRutForDisplay(value) {
  const r = normalizeRut(value);
  if (!r) return "";
  const m = r.match(/^(\d+)-([0-9KBH])$/);
  if (!m) return r;
  const [, num, dv] = m;
  const withDots = num.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${dv}`;
}
