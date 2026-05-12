// RUT helpers — copia minimalista de adminAgrofrutos/src/utils/rutUtils.js
// Solo lo que el portal necesita: normalizar y formatear para mostrar.
// Si cambia el contrato en admin (RUTs extranjeros con sufijos distintos,
// reglas nuevas), refrescar este archivo.

export function normalizeRut(value) {
  if (!value) return "";
  return String(value).replace(/[.\s]/g, "").toUpperCase();
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
