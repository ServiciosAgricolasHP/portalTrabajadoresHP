// Bancos chilenos — copia minimalista de adminAgrofrutos/src/utils/banks.js.
// Solo lo que el portal necesita para mostrar forma de pago legible.
// Si cambia el contrato en admin (bancos nuevos, tipos de cuenta), refrescar.

export const BANKS = [
  { code: "EFE", name: "Efectivo" },
  { code: "012", name: "Banco del Estado de Chile" },
  { code: "001", name: "Banco de Chile" },
  { code: "037", name: "Banco Santander" },
  { code: "016", name: "Banco de Crédito e Inversiones/Mach" },
  { code: "504", name: "Banco BBVA" },
  { code: "027", name: "Banco Corpbanca" },
  { code: "028", name: "Banco BICE" },
  { code: "055", name: "Banco Consorcio" },
  { code: "507", name: "Banco del Desarrollo" },
  { code: "051", name: "Banco Falabella" },
  { code: "009", name: "Banco Internacional" },
  { code: "039", name: "Banco Itaú Chile" },
  { code: "053", name: "Banco Ripley" },
  { code: "031", name: "HSBC Bank (Chile)" },
  { code: "014", name: "Scotiabank / Sud Americano" },
  { code: "730", name: "Tempo" },
  { code: "875", name: "MercadoLibre" },
];

export const ACCOUNT_TYPES = [
  { value: 0, label: "Cuenta Corriente" },
  { value: 1, label: "Cuenta Vista" },
  { value: 3, label: "Cuenta RUT" },
];

export const bankName = (code) =>
  BANKS.find((b) => b.code === code)?.name || code || "—";

export const accountTypeLabel = (v) => {
  if (v === null || v === undefined || v === "") return "";
  return ACCOUNT_TYPES.find((t) => t.value === Number(v))?.label || "";
};
