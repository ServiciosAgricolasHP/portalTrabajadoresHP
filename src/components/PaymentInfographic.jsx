import { useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import { formatRutForDisplay } from "../utils/rutUtils.js";
import {
  fmtCurrency,
  fmtDateLong,
  fmtTimestamp,
} from "../utils/formatters.js";

// Forma de pago legible: si el banco es "EFE" o el código está vacío =>
// Efectivo. En cualquier otro caso, mostramos código + 4 últimos dígitos
// de la cuenta (no la cuenta completa, por privacidad si el portal queda
// expuesto).
function paymentSummary(worker) {
  const bank = String(worker?.bankCode || "").toUpperCase();
  if (!bank || bank === "EFE") return { label: "Efectivo", detail: null };
  const acct = String(worker?.accountNumber || "").trim();
  const last4 = acct ? `····${acct.slice(-4)}` : "";
  return { label: `Banco ${bank}`, detail: last4 };
}

// Texto plano para "Copiar texto" — pensado para pegarse en WhatsApp sin que
// se rompa el layout. Usamos saltos de línea simples y separadores ASCII en
// vez de tabs/columnas, así sobrevive a cualquier app de mensajería.
function buildPlainText({ snapshot, worker, cycleLabels }) {
  const lines = [];
  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const gross = Number(worker.grossAmount) || total + advance;

  lines.push(`*${snapshot.payroll?.name || "Nómina"}*`);
  lines.push(`Trabajador: ${worker.name}`);
  lines.push(`RUT: ${formatRutForDisplay(worker.rut)}`);
  if (worker.groupLeader) lines.push(`Grupo: ${worker.groupLeader}`);
  lines.push("");
  lines.push("— Detalle —");

  const byCycle = worker.byCycle || {};
  const cycleIds = Object.keys(byCycle);
  if (cycleIds.length > 1) {
    cycleIds.forEach((cid) => {
      const amt = Number(byCycle[cid]?.amount ?? byCycle[cid]) || 0;
      lines.push(`• ${cycleLabels[cid] || cid}: ${fmtCurrency(amt)}`);
    });
    lines.push(`Subtotal bruto: ${fmtCurrency(gross)}`);
  } else {
    lines.push(`Bruto: ${fmtCurrency(gross)}`);
  }
  if (advance > 0) lines.push(`Anticipo: − ${fmtCurrency(advance)}`);
  lines.push(`*Total a pagar: ${fmtCurrency(total)}*`);

  const pay = paymentSummary(worker);
  lines.push("");
  lines.push(`Forma de pago: ${pay.label}${pay.detail ? ` ${pay.detail}` : ""}`);
  if (snapshot.generatedAt) {
    lines.push(`Generado: ${fmtTimestamp(snapshot.generatedAt)}`);
  }
  lines.push("");
  lines.push("HP Servicios Agrícolas");
  return lines.join("\n");
}

export default function PaymentInfographic({ snapshot, worker }) {
  const captureRef = useRef(null);
  const [busy, setBusy] = useState(null); // "img" | "text" | null
  const [flash, setFlash] = useState(null); // mensaje breve tipo toast

  const cycleLabels = useMemo(() => {
    const m = {};
    (snapshot?.cycles || []).forEach((c) => {
      m[c.id] = c.label || c.id;
    });
    return m;
  }, [snapshot]);

  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const gross = Number(worker.grossAmount) || total + advance;
  const byCycle = worker.byCycle || {};
  const cycleIds = Object.keys(byCycle).filter(
    (cid) => Number(byCycle[cid]?.amount ?? byCycle[cid]) > 0,
  );
  const multiCycle = cycleIds.length > 1;
  const pay = paymentSummary(worker);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  };

  const handleCopyImage = async () => {
    if (!captureRef.current) return;
    setBusy("img");
    try {
      // pixelRatio 2 da una imagen nítida en WhatsApp / pantallas retina.
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      if (!blob) throw new Error("blob vacío");
      // Algunos navegadores (Safari iOS) bloquean ClipboardItem en algunos
      // contextos; en ese caso, hacemos fallback a descarga PNG.
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          showFlash("Imagen copiada");
          return;
        } catch {
          /* fallthrough a descarga */
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pago-${worker.rut}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showFlash("Imagen descargada");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo copiar la imagen");
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadImage = async () => {
    if (!captureRef.current) return;
    setBusy("img");
    try {
      const dataUrl = await toPng(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `pago-${worker.rut}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showFlash("Imagen descargada");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo generar la imagen");
    } finally {
      setBusy(null);
    }
  };

  const handleCopyText = async () => {
    setBusy("text");
    try {
      const text = buildPlainText({ snapshot, worker, cycleLabels });
      await navigator.clipboard.writeText(text);
      showFlash("Texto copiado");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo copiar el texto");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Tarjeta capturada por html-to-image */}
      <div
        ref={captureRef}
        className="infografia rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-teal-700">
              {snapshot.payroll?.name || "Nómina"}
            </div>
            <h2 className="mt-0.5 text-lg font-semibold leading-tight text-slate-800 sm:text-xl">
              {worker.name}
            </h2>
            <div className="mt-0.5 font-mono text-sm text-slate-500">
              {formatRutForDisplay(worker.rut)}
            </div>
            {worker.groupLeader && (
              <div className="mt-1 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
                Grupo {worker.groupLeader}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              HP
            </div>
            <div className="text-2xl">🌾</div>
          </div>
        </header>

        {/* Total destacado */}
        <div className="my-5 rounded-xl bg-teal-700 px-4 py-5 text-white shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-teal-100">
            Total a pagar
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
            {fmtCurrency(total)}
          </div>
        </div>

        {/* Desglose */}
        <section className="space-y-2 text-sm">
          {multiCycle && (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Por ciclo
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {cycleIds.map((cid) => {
                  const entry = byCycle[cid];
                  const amt = Number(entry?.amount ?? entry) || 0;
                  return (
                    <li
                      key={cid}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="text-slate-700">
                        {cycleLabels[cid] || cid}
                      </span>
                      <span className="font-medium tabular-nums text-slate-800">
                        {fmtCurrency(amt)}
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-center justify-between bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">Bruto</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {fmtCurrency(gross)}
                  </span>
                </li>
              </ul>
            </>
          )}
          {!multiCycle && (
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <span className="text-slate-700">Bruto</span>
              <span className="font-medium tabular-nums text-slate-800">
                {fmtCurrency(gross)}
              </span>
            </div>
          )}

          {advance > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <span className="text-amber-800">
                Anticipo aplicado
                {worker.advanceNote ? (
                  <span className="ml-1 text-[11px] text-amber-700">
                    ({worker.advanceNote})
                  </span>
                ) : null}
              </span>
              <span className="font-medium tabular-nums text-amber-900">
                − {fmtCurrency(advance)}
              </span>
            </div>
          )}
        </section>

        {/* Forma de pago */}
        <div className="mt-5 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">Forma de pago</span>
          <span className="font-medium text-slate-800">
            {pay.label}
            {pay.detail && (
              <span className="ml-1 font-mono text-slate-500">{pay.detail}</span>
            )}
          </span>
        </div>

        <footer className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-400">
          <span>
            Generado: {fmtTimestamp(snapshot.generatedAt)}
            {snapshot.payroll?.status === "paid" && snapshot.paidAt
              ? ` · Pagado: ${fmtDateLong(snapshot.paidAt)}`
              : ""}
          </span>
          <span>HP Servicios Agrícolas</span>
        </footer>
      </div>

      {/* Acciones (fuera del capture para no aparecer en la foto) */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopyImage}
          disabled={busy === "img"}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          📷 {busy === "img" ? "..." : "Copiar imagen"}
        </button>
        <button
          onClick={handleDownloadImage}
          disabled={busy === "img"}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          title="Descargar PNG"
        >
          ⬇
        </button>
        <button
          onClick={handleCopyText}
          disabled={busy === "text"}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          📋 {busy === "text" ? "..." : "Copiar texto"}
        </button>
      </div>

      {flash && (
        <div className="fixed inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-slate-900 px-4 py-2 text-xs text-white shadow-lg">
          {flash}
        </div>
      )}
    </div>
  );
}
