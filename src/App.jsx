import { useEffect, useState } from "react";
import RutForm from "./components/RutForm.jsx";
import PaymentInfographic from "./components/PaymentInfographic.jsx";
import { normalizeRut } from "./utils/rutUtils.js";
import { isBanned } from "./utils/banlist.js";
import { getPayslip, getPublishedPayroll } from "./utils/portalData.js";

// El portal muestra la nómina que TeRRa publicó (una por vez). Al abrir lee
// su cabecera, y al buscar un RUT lee solo la ficha de esa persona.
export default function App() {
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payslip, setPayslip] = useState(null);
  const [worker, setWorker] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const published = await getPublishedPayroll();
        if (!published) throw new Error("Todavía no hay una nómina publicada.");
        if (!cancelled) setMeta(published);
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

  // Una ficha que no es de la nómina publicada (quedó de una anterior)
  // cuenta como no encontrada.
  const handleSubmit = async (raw) => {
    setNotFound(false);
    setSearchError(null);
    setWorker(null);
    setPayslip(null);
    if (!meta) return;
    const rut = normalizeRut(raw);
    if (!rut) return;
    // La banlist da el mismo mensaje que "no encontrado", para no revelar que
    // el RUT está bloqueado.
    if (isBanned(rut)) {
      setNotFound(true);
      return;
    }
    setSearching(true);
    try {
      const doc = await getPayslip(rut);
      const found = doc && doc.payrollId === meta.payrollId ? doc.workers?.[0] : null;
      if (found) {
        setPayslip(doc);
        setWorker(found);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setSearchError(err?.message || String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleClear = () => {
    setWorker(null);
    setPayslip(null);
    setNotFound(false);
    setSearchError(null);
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
            Los datos no están disponibles. Pide al administrador que publique
            la nómina más reciente.
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
            payroll={meta?.payroll}
            generatedAt={meta?.generatedAt}
            onSubmit={handleSubmit}
            notFound={notFound}
            searching={searching}
            searchError={searchError}
          />
        )}

        {worker && (
          <PaymentInfographic snapshot={payslip} worker={worker} />
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
