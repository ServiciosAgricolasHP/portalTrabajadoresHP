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
public/
  data.json                      ← snapshot de la nómina activa
```

## Schema de `data.json` (contrato externo con admin)

Es **exactamente** lo que escribe `payrollSnapshotsService` en adminAgrofrutos. Lo que usa el portal:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-05-10T15:00:00.000Z",
  "payroll": {
    "name": "...",
    "status": "pending" | "paid",
    "total": 0,
    "advanceTotal": 0,
    "workerCount": 0
  },
  "cycles": [{ "id": "...", "label": "..." }],
  "workers": [
    {
      "rut": "12345678-9",
      "name": "...",
      "groupLeader": "...",
      "bankCode": "EFE | 012 | ...",
      "accountNumber": "...",
      "grossAmount": 0,
      "advance": 0,
      "advanceNote": "",
      "amount": 0,
      "byCycle": { "<cycleId>": { "amount": 0 } }
    }
  ]
}
```

> Si admin agrega o renombra campos, hay que **refrescar este portal** (no romper silenciosamente). Está bueno bumpear `version` cuando rompa compatibilidad.

## Privacidad

- El portal es público — cualquiera con la URL ve la nómina. No exponemos número de cuenta completo: solo banco + 4 últimos dígitos.
- Lo demás (nombre, RUT, monto) sí queda visible al que conozca un RUT válido. Para el caso de uso (trabajador agrícola consultando su propio pago) está OK; si en el futuro queremos rate-limit / login por RUT+DV / token, ese cambio va acá.
