// Datos del portal: la nómina publicada (`portalMeta/current`) y la ficha de
// cada trabajador (`portalPayslips/{rut}`), que TeRRa publica en Firestore.
// Se leen con la API REST, sin sesión ni SDK: las reglas dejan leer de a un
// documento, sin listar.
// `VITE_FIRESTORE_DOCUMENTS` apunta a otra base, por ejemplo al emulador:
// `http://127.0.0.1:8080/v1/projects/demo-terra-test/databases/hpdatabase/documents`.
const DOCUMENTS =
  import.meta.env?.VITE_FIRESTORE_DOCUMENTS ||
  "https://firestore.googleapis.com/v1/projects/arandanos-hp/databases/hpdatabase/documents";

// Valor tipado de la API REST → valor de JavaScript.
export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

// Un documento, o `null` si no existe.
async function getDocument(path) {
  const res = await fetch(`${DOCUMENTS}/${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return decodeFields(json.fields);
}

// Cabecera de la nómina publicada: `{ payrollId, payroll: { name, status },
// generatedAt, publishedAt, workerCount }`.
export const getPublishedPayroll = () => getDocument("portalMeta/current");

// Ficha de un trabajador: la nómina recortada a esa persona, con la misma
// forma que el JSON de la nómina (`cycles`, `workers: [uno]`, `workdays`,
// `advances`), más el `payrollId` al que pertenece.
export const getPayslip = (rut) => getDocument(`portalPayslips/${encodeURIComponent(rut)}`);
