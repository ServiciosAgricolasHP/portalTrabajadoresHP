import { useState } from "react";
import { formatRutForDisplay, normalizeRut } from "../utils/rutUtils.js";
import { fmtTimestamp } from "../utils/formatters.js";

export default function RutForm({
  payroll,
  generatedAt,
  onSubmit,
  notFound,
}) {
  const [value, setValue] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const v = normalizeRut(value);
    if (!v) return;
    onSubmit(v);
  };

  // El input acepta cualquier formato (con puntos, sin puntos, con o sin
  // guión). Internamente normalizamos antes de buscar.
  const handleChange = (e) => {
    const raw = e.target.value;
    setValue(raw);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">
          {payroll?.name || "Nómina actual"}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Generada {fmtTimestamp(generatedAt)}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-2">
          <label
            htmlFor="rut"
            className="block text-sm font-medium text-slate-700"
          >
            Ingresá tu RUT
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="rut"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoFocus
              placeholder="12.345.678-9"
              value={value}
              onChange={handleChange}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
            <button
              type="submit"
              disabled={!normalizeRut(value)}
              className="rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
            >
              Ver mi pago
            </button>
          </div>
          {value && (
            <p className="text-[11px] text-slate-400">
              Se buscará como{" "}
              <span className="font-mono text-slate-500">
                {formatRutForDisplay(value) || value}
              </span>
            </p>
          )}
        </form>

        {notFound && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No encontramos tu RUT en esta nómina. Verificá los dígitos o
            consultá con tu líder de grupo.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <p>
          <span className="font-medium text-slate-700">¿Qué es esto?</span>{" "}
          Esta página te muestra cuánto se te pagó en la última nómina, el
          desglose por ciclo y los descuentos aplicados.
        </p>
      </div>
    </div>
  );
}
