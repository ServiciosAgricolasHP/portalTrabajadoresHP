# Portal Trabajadores HP

Portal público de consulta de pagos para los trabajadores de HP Servicios Agrícolas. El trabajador ingresa su RUT y ve una infografía con el detalle de la nómina vigente, con opciones de copiar imagen y copiar texto.

> Fuente de datos: Firestore (`arandanos-hp`, base `hpdatabase`). **TeRRa** publica la nómina con el botón **🌐 Publicar en portal** del detalle de una nómina: una ficha por trabajador en `portalPayslips/{rut}` y la cabecera en `portalMeta/current`. El portal sirve **una nómina por vez**.

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

En **TeRRa → Nómina**, abrir la nómina y apretar **🌐 Publicar en portal** (solo admin). La publica la función `publishPortal` de TeRRa (`functions/portal.js`) y se ve al instante: **no hace falta volver a desplegar el portal**. El historial marca con **🌐 Portal** la que está publicada.

- Al abrir, el portal lee `portalMeta/current` (1 lectura). Al buscar un RUT lee solo `portalPayslips/{rut}` (1 lectura). Las dos se hacen con la API REST de Firestore, sin sesión y sin SDK (`src/utils/portalData.js`).
- Las reglas de Firestore dejan leer **de a un documento**: nadie puede bajar la nómina entera. Cada ficha trae solo lo de esa persona y la cuenta en 4 dígitos.
- Una ficha cuyo `payrollId` no es el de la cabecera cuenta como "no encontrado".
- El portal se vuelve a desplegar solo cuando cambia su código.

## Estructura

```
src/
  main.jsx                       ← entry
  App.jsx                        ← layout + cabecera publicada + búsqueda por RUT
  index.css                      ← Tailwind import + vars HP
  components/
    RutForm.jsx                  ← input de RUT + cabecera de la nómina
    PaymentInfographic.jsx       ← tarjeta capturada + acciones "copiar imagen/texto"
  utils/
    rutUtils.js                  ← normalizar / formatear RUT (espejo del de admin)
    formatters.js                ← currency, fecha larga, timestamp
    banks.js                     ← nombre de banco / tipo de cuenta (espejo del de admin)
    portalData.js                ← lectura de la cabecera y de la ficha por RUT (API REST de Firestore)
```

## Schema de una ficha (contrato con TeRRa)

Cada `portalPayslips/{rut}` tiene la forma del JSON de la nómina (`payrollSnapshots` en TeRRa) **recortada a un trabajador**: `workers` trae solo a esa persona (sin correo ni RUT de pago, y la cuenta en sus últimos 4 dígitos), y `cycles`, `workdays` y `advances`, solo lo suyo (los ciclos, sin `dayPrices`). Además lleva `payrollId` y `publishedAt`. Abajo se marca con `←` lo que el portal usa.

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
