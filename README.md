# Portal Trabajadores HP

Portal público de consulta de pagos para los trabajadores de HP Servicios Agrícolas. El trabajador ingresa su RUT y ve una infografía con el detalle de la nómina vigente, con opciones de copiar imagen y copiar texto.

> Fuente de datos: un archivo `data.json` estático, generado por **adminAgrofrutos** al cerrar una nómina (botón "📥 JSON" en el historial). El portal sirve **una nómina activa por vez**.

## Stack

- **React 19** + **Vite 7**
- **Tailwind CSS 4**
- **html-to-image** para "copiar imagen"
- **React Compiler** (`babel-plugin-react-compiler`)
- **ESLint** flat config

## Comandos

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo (HMR) |
| `npm run build` | Build de producción → `dist/` |
| `npm run preview` | Preview local del build |
| `npm run lint` | ESLint |
| `npm run deploy` | Build + push a GitHub Pages (`gh-pages`) |

## Despliegue

GitHub Pages → `https://serviciosagricolashp.github.io/portalTrabajadoresHP/`

Path base `/portalTrabajadoresHP/` está en `vite.config.js`. No hay router — todo es una sola ruta.

## Cómo publicar una nueva nómina

1. En **adminAgrofrutos**, generá o re-descargá el snapshot JSON de la nómina (botón **📥 JSON** en el historial de Nómina).
2. Renombrá ese archivo a `data.json` y reemplazalo en [`public/data.json`](public/data.json).
3. Verificá localmente con `npm run dev`.
4. `npm run deploy` para publicar.

> El portal lee `public/data.json` con `cache: "no-store"`, así que basta con re-deploy para que los trabajadores vean la nómina nueva sin tener que limpiar caché.

## Estructura

```
src/
  main.jsx                       ← entry
  App.jsx                        ← layout + carga de data.json + búsqueda por RUT
  index.css                      ← Tailwind import + vars HP
  components/
    RutForm.jsx                  ← input de RUT + cabecera de la nómina
    PaymentInfographic.jsx       ← tarjeta capturada + acciones "copiar imagen/texto"
  utils/
    rutUtils.js                  ← normalizar / formatear RUT (espejo del de admin)
    formatters.js                ← currency, fecha larga, timestamp
    banks.js                     ← nombre de banco / tipo de cuenta (espejo del de admin)
public/
  data.json                      ← snapshot de la nómina activa
```

## Schema de `data.json` (contrato externo con admin)

Es **exactamente** lo que escribe `payrollSnapshotsService` en adminAgrofrutos (ver `Payroll.jsx` → snapshot al generar/recalcular una nómina). El portal no lee todos los campos — abajo se marca con `←` lo que sí usa. Todo lo demás (`dayPrices`, `advanceIds`, `workdayIds`, `tierKey`, etc.) viaja en el archivo pero el portal lo ignora a propósito.

El detalle del trabajador replica el mismo formato que usa admin internamente para el detalle de un trabajador dentro de una nómina (`Payroll.jsx` → `WorkerPaidDetailTables`): resumen Bruto/Anticipos/Bonos/Neto arriba, vista **Cronológica** por defecto (jornadas y anticipos/bonos intercalados por fecha) y vista alternativa **Por ciclo** (subtotal por ciclo + bloque de ajustes al final).

```jsonc
{
  "version": 1,
  "generatedAt": "2026-05-10T15:00:00.000Z",
  "payrollId": "...",
  "payroll": {
    "name": "...",                        // ←
    "status": "pending" | "paid",         // ←
    // total/bankTotal/cashTotal/workerCount/advanceTotal/bonusTotal: no leídos por el portal
  },
  "cycles": [
    {
      "id": "...", "label": "...",        // ←
      "faenaName": "...", "subfaenaName": "...", // ← (arman el "contexto" de cada fila del detalle)
      "labors": [
        {
          "id": "...", "name": "...",     // ←
          "type": "cosecha" | "trato" | "tratoEtapas" | "tratoHE" | "main" | "supervision" | "extra", // ←
          "stages": [{ "id": "...", "name": "...", "counts": true }] // ← solo si type es "tratoEtapas"
        }
      ]
    }
  ],
  "workers": [
    {
      "rut": "12345678-9",                // ←
      "name": "...",                      // ←
      "groupLeader": "...",               // ←
      "bankCode": "EFE | 012 | ...",       // ← (se muestra el nombre del banco, no el código)
      "accountNumber": "...",             // ← (solo últimos 4 dígitos)
      "accountType": 0 | 1 | 3 | null,     // ← (Cuenta Corriente / Vista / RUT)
      "grossAmount": 0,                   // ←
      "advance": 0,                       // ← anticipo total, se resta del bruto
      "bonus": 0,                         // ← bono total, se suma al bruto
      "anticipoApplications": [{ "advanceId": "...", "amount": 0 }], // ← se cruza contra `advances[]` para fecha/nota
      "bonoApplications": [{ "advanceId": "...", "amount": 0 }],     // ← idem, para bonos
      "amount": 0,                        // ← neto a pagar = grossAmount − advance + bonus
      "byCycle": { "<cycleId>": 0 }        // ← fallback cuando no hay `workdays` (números planos, no objetos)
    }
  ],
  "workdays": [
    {
      "id": "...", "cycleId": "...", "laborId": "...", "workerRut": "...", // ←
      "date": "YYYY-MM-DD", "amount": 0,  // ←
      "qty": 0, "tiers": null,            // ← (trato multi-precio)
      "stageId": null,                    // ← (solo labores tratoEtapas — indexa contra `labor.stages`)
      "overtimeHours": 0,                 // ← (solo tratoHE)
      "attendanceOnly": false             // ← (labores "al día" — se muestra "presente")
    }
  ],
  "advances": [
    { "id": "...", "workerRut": "...", "type": "anticipo" | "bono", "amount": 0, "date": "YYYY-MM-DD", "note": "..." } // ← fecha/nota de cada fila de ajuste
  ]
}
```

> Si admin agrega o renombra campos, hay que **refrescar este portal** (no romper silenciosamente). Está bueno bumpear `version` cuando rompa compatibilidad. Historial: `bonus`/`bonosTotal`, el labor type `tratoEtapas` (con `stages`/`stageId`) y el uso del array `advances` para el detalle cronológico se agregaron/sincronizaron en admin después de la versión inicial de este portal y se pusieron al día acá en 2026-09.

## Privacidad

- El portal es público — cualquiera con la URL ve la nómina. No exponemos número de cuenta completo: solo banco + 4 últimos dígitos.
- Lo demás (nombre, RUT, monto) sí queda visible al que conozca un RUT válido. Para el caso de uso (trabajador agrícola consultando su propio pago) está OK; si en el futuro queremos rate-limit / login por RUT+DV / token, ese cambio va acá.
