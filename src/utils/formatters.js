// Formatters compartidos. Si hay drift contra adminAgrofrutos, refrescar.

export const fmtCurrency = (value) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

export const fmtNumber = (value) =>
  new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    Number(value) || 0,
  );

// "2026-05-11" → "11 may 2026" en español.
export function fmtDateLong(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return String(yyyyMmDd);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ISO timestamp → "11 may 2026, 14:32"
export function fmtTimestamp(iso) {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    return date.toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}
