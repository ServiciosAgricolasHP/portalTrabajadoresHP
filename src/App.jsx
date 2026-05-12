import { useEffect, useState } from "react";
import RutForm from "./components/RutForm.jsx";
import PaymentInfographic from "./components/PaymentInfographic.jsx";
import { normalizeRut } from "./utils/rutUtils.js";
import { isBanned } from "./utils/banlist.js";

// El portal sirve un único `data.json` que vive en /public. Lo escribe
// adminAgrofrutos al generar una nómina (botón "📥 JSON" en historial) y
// el operador lo deposita acá antes de hacer deploy. Convención: una sola
// nómina activa por vez. Si en el futuro queremos histórico, este loader
// pasa a leer un índice y a buscar el item correcto.
function dataUrl() {
  // import.meta.env.BASE_URL respeta el base de Vite (`/portalTrabajadoresHP/`)
  // en producción y `/` en dev.
  return `${import.meta.env.BASE_URL}data.json`;
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [worker, setWorker] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(dataUrl(), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setSnapshot(json);
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = (raw) => {
    setNotFound(false);
    setWorker(null);
    if (!snapshot) return;
    const rut = normalizeRut(raw);
    if (!rut) return;
    // Banlist tiene prioridad: mismo mensaje que "no encontrado" — no
    // queremos que el portal revele que el RUT está bloqueado.
    if (isBanned(rut)) {
      setNotFound(true);
      return;
    }
    const found = (snapshot.workers || []).find(
      (w) => normalizeRut(w.rut) === rut,
    );
    if (found) setWorker(found);
    else setNotFound(true);
  };

  const handleClear = () => {
    setWorker(null);
    setNotFound(false);
  };

  if (loading) {
    return (
      <Centered>
        <p className="text-sm text-slate-500">Cargando…</p>
      </Centered>
    );
  }

  if (loadError) {
    return (
      <Centered>
        <Card>
          <h1 className="text-lg font-semibold">No se pudo cargar la nómina</h1>
          <p className="mt-2 text-sm text-slate-600">
            El archivo de datos no está disponible. Pedile al administrador que
            publique la nómina más reciente.
          </p>
          <p className="mt-3 break-all rounded bg-slate-50 p-2 text-[11px] font-mono text-slate-500">
            {loadError}
          </p>
        </Card>
      </Centered>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌾</span>
            <div>
              <div className="text-sm font-semibold leading-tight">
                HP Servicios Agrícolas
              </div>
              <div className="text-[11px] leading-tight text-slate-500">
                Portal de Trabajadores
              </div>
            </div>
          </div>
          {worker && (
            <button
              onClick={handleClear}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Otra consulta
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {!worker && (
          <RutForm
            payroll={snapshot?.payroll}
            generatedAt={snapshot?.generatedAt}
            onSubmit={handleSubmit}
            notFound={notFound}
          />
        )}

        {worker && (
          <PaymentInfographic snapshot={snapshot} worker={worker} />
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-8 pt-4 text-center text-[11px] text-slate-400">
        Información referencial — el resumen oficial es el comprobante firmado
        de la nómina.
      </footer>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      {children}
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {children}
    </div>
  );
}
