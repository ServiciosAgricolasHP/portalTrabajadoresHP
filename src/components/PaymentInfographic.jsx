import { useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import { formatRutForDisplay, normalizeRut } from "../utils/rutUtils.js";
import {
  fmtCurrency,
  fmtDateLong,
  fmtDateShort,
  fmtNumber,
  fmtTimestamp,
} from "../utils/formatters.js";

const LABOR_TYPE_LABEL = {
  cosecha: "cosecha",
  trato: "a trato",
  tratoHE: "jornadas",
  main: "al día",
  supervision: "supervisión",
  extra: "adicional",
};

// Forma de pago legible. Para no exponer la cuenta completa cuando el portal
// es público mostramos solo los últimos 4 dígitos.
function paymentSummary(worker) {
  const bank = String(worker?.bankCode || "").toUpperCase();
  if (!bank || bank === "EFE") return { label: "Efectivo", detail: null };
  const acct = String(worker?.accountNumber || "").trim();
  const last4 = acct ? `····${acct.slice(-4)}` : "";
  return { label: `Banco ${bank}`, detail: last4 };
}

// Cantidad efectiva del workday, agregando tiers si es trato multi-precio.
function workdayQty(wd) {
  if (wd?.tiers && typeof wd.tiers === "object") {
    const sum = Object.values(wd.tiers).reduce(
      (s, t) => s + (Number(t?.qty) || 0),
      0,
    );
    if (sum > 0) return sum;
  }
  return Number(wd?.qty) || 0;
}

// "Lo que hizo ese día" — texto corto al lado de la fecha. Vacío para
// labores al día (el monto ya cuenta la historia).
function workdayDescription(wd, laborType) {
  if (wd?.attendanceOnly) return "presente";
  const qty = workdayQty(wd);
  if (qty <= 0) return "";
  if (laborType === "cosecha") return `${fmtNumber(qty)} kg`;
  if (laborType === "tratoHE") {
    const parts = [`${fmtNumber(qty)} j`];
    const he = Number(wd?.overtimeHours) || 0;
    if (he > 0) parts.push(`${fmtNumber(he)} HE`);
    return parts.join(" + ");
  }
  if (laborType === "trato") return `${fmtNumber(qty)}`;
  return "";
}

// Agrupa los workdays del trabajador por ciclo → labor → fecha. Si el
// snapshot fue generado por una versión vieja de admin y no tiene workdays,
// devuelve [] (el componente cae al modo resumen por ciclo).
function buildBreakdown(snapshot, workerRut) {
  const targetRut = normalizeRut(workerRut);
  const all = (snapshot?.workdays || []).filter(
    (wd) => normalizeRut(wd.workerRut) === targetRut,
  );
  if (all.length === 0) return [];

  const cycleMap = new Map(); // cycleId → { cycle, laborsMap }
  (snapshot?.cycles || []).forEach((c) => {
    cycleMap.set(c.id, { cycle: c, laborsMap: new Map() });
  });

  for (const wd of all) {
    let entry = cycleMap.get(wd.cycleId);
    if (!entry) {
      // workday huérfano (ciclo no listado) — lo metemos con label genérica
      entry = { cycle: { id: wd.cycleId, label: wd.cycleId, labors: [] }, laborsMap: new Map() };
      cycleMap.set(wd.cycleId, entry);
    }
    let lab = entry.laborsMap.get(wd.laborId);
    if (!lab) {
      const labor = (entry.cycle.labors || []).find((l) => l.id === wd.laborId) || {
        id: wd.laborId,
        name: wd.laborId,
        type: "main",
      };
      lab = { labor, workdays: [], subtotal: 0 };
      entry.laborsMap.set(wd.laborId, lab);
    }
    lab.workdays.push(wd);
    lab.subtotal += Number(wd.amount) || 0;
  }

  // Ordenar y producir array final
  const out = [];
  for (const { cycle, laborsMap } of cycleMap.values()) {
    if (laborsMap.size === 0) continue;
    const labors = [...laborsMap.values()].map((l) => ({
      ...l,
      workdays: l.workdays.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))),
    }));
    const subtotal = labors.reduce((s, l) => s + l.subtotal, 0);
    out.push({ cycle, labors, subtotal });
  }
  // Ordenar ciclos por orden en cycles[]
  const order = new Map((snapshot?.cycles || []).map((c, i) => [c.id, i]));
  out.sort((a, b) => (order.get(a.cycle.id) ?? 999) - (order.get(b.cycle.id) ?? 999));
  return out;
}

function buildPlainText({ snapshot, worker, breakdown }) {
  const lines = [];
  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const gross = Number(worker.grossAmount) || total + advance;

  lines.push(`*${snapshot.payroll?.name || "Nómina"}*`);
  lines.push(`Trabajador: ${worker.name}`);
  lines.push(`RUT: ${formatRutForDisplay(worker.rut)}`);
  if (worker.groupLeader) lines.push(`Grupo: ${worker.groupLeader}`);

  if (breakdown.length > 0) {
    for (const { cycle, labors, subtotal } of breakdown) {
      lines.push("");
      lines.push(`— ${cycle.label || cycle.id} —`);
      for (const { labor, workdays, subtotal: laborTotal } of labors) {
        const typeLabel = LABOR_TYPE_LABEL[labor.type] || labor.type || "";
        lines.push(`  ${labor.name}${typeLabel ? ` (${typeLabel})` : ""}`);
        for (const wd of workdays) {
          const descr = workdayDescription(wd, labor.type);
          const left = `${fmtDateShort(wd.date)}${descr ? ` · ${descr}` : ""}`;
          const right = Number(wd.amount) > 0 ? fmtCurrency(wd.amount) : "—";
          lines.push(`    ${left.padEnd(20, " ")} ${right}`);
        }
        lines.push(`    Subtotal: ${fmtCurrency(laborTotal)}`);
      }
      lines.push(`Subtotal faena: ${fmtCurrency(subtotal)}`);
    }
    lines.push("");
    lines.push(`Bruto: ${fmtCurrency(gross)}`);
  } else {
    // Fallback: solo resumen por ciclo (snapshots viejos sin workdays)
    lines.push("");
    lines.push("— Detalle —");
    const byCycle = worker.byCycle || {};
    const ids = Object.keys(byCycle);
    if (ids.length > 1) {
      const cycleLabels = {};
      (snapshot.cycles || []).forEach((c) => (cycleLabels[c.id] = c.label || c.id));
      ids.forEach((cid) => {
        const amt = Number(byCycle[cid]?.amount ?? byCycle[cid]) || 0;
        lines.push(`• ${cycleLabels[cid] || cid}: ${fmtCurrency(amt)}`);
      });
    }
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
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null);

  const breakdown = useMemo(
    () => buildBreakdown(snapshot, worker.rut),
    [snapshot, worker.rut],
  );

  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const gross = Number(worker.grossAmount) || total + advance;
  const pay = paymentSummary(worker);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  };

  const handleCopyImage = async () => {
    if (!captureRef.current) return;
    setBusy("img");
    try {
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      if (!blob) throw new Error("blob vacío");
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
      const text = buildPlainText({ snapshot, worker, breakdown });
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

        <div className="my-5 rounded-xl bg-teal-700 px-4 py-5 text-white shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-teal-100">
            Total a pagar
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
            {fmtCurrency(total)}
          </div>
        </div>

        {/* Detalle por faena → labor → día */}
        {breakdown.length > 0 ? (
          <section className="space-y-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Detalle por faena
            </div>
            {breakdown.map(({ cycle, labors, subtotal }) => (
              <article
                key={cycle.id}
                className="overflow-hidden rounded-lg border border-slate-200"
              >
                <header className="flex items-baseline justify-between gap-3 bg-slate-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-800">
                    {cycle.label || cycle.id}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {fmtCurrency(subtotal)}
                  </span>
                </header>
                <div className="divide-y divide-slate-100">
                  {labors.map(({ labor, workdays, subtotal: laborTotal }) => {
                    const typeLabel = LABOR_TYPE_LABEL[labor.type] || labor.type || "";
                    return (
                      <div key={labor.id} className="px-3 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                          <span className="font-medium text-slate-700">
                            {labor.name}
                            {typeLabel && (
                              <span className="ml-1 text-slate-400">
                                · {typeLabel}
                              </span>
                            )}
                          </span>
                          <span className="font-medium tabular-nums text-slate-700">
                            {fmtCurrency(laborTotal)}
                          </span>
                        </div>
                        <ul className="mt-1.5 space-y-0.5">
                          {workdays.map((wd) => {
                            const descr = workdayDescription(wd, labor.type);
                            const amt = Number(wd.amount) || 0;
                            return (
                              <li
                                key={wd.id || `${wd.date}-${wd.tierKey || ""}`}
                                className="flex items-baseline justify-between gap-2 text-[11px] text-slate-600"
                              >
                                <span className="tabular-nums">
                                  <span className="text-slate-500">
                                    {fmtDateShort(wd.date)}
                                  </span>
                                  {descr && (
                                    <span className="ml-1 text-slate-700">
                                      · {descr}
                                    </span>
                                  )}
                                </span>
                                <span className="tabular-nums text-slate-700">
                                  {amt > 0 ? fmtCurrency(amt) : "—"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="text-slate-700">Bruto</span>
              <span className="font-medium tabular-nums text-slate-800">
                {fmtCurrency(gross)}
              </span>
            </div>
          </section>
        ) : (
          // Snapshots viejos sin workdays — caemos al resumen por ciclo
          <FallbackByCycle worker={worker} snapshot={snapshot} gross={gross} />
        )}

        {advance > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
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

        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
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

// Resumen simple por ciclo, sin detalle día por día. Solo se renderiza
// cuando el snapshot no incluye `workdays` (versiones viejas de admin).
function FallbackByCycle({ worker, snapshot, gross }) {
  const cycleLabels = {};
  (snapshot.cycles || []).forEach((c) => {
    cycleLabels[c.id] = c.label || c.id;
  });
  const byCycle = worker.byCycle || {};
  const cycleIds = Object.keys(byCycle).filter(
    (cid) => Number(byCycle[cid]?.amount ?? byCycle[cid]) > 0,
  );
  if (cycleIds.length > 1) {
    return (
      <section className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Por faena
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {cycleIds.map((cid) => {
            const entry = byCycle[cid];
            const amt = Number(entry?.amount ?? entry) || 0;
            return (
              <li
                key={cid}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="text-slate-700">{cycleLabels[cid] || cid}</span>
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
      </section>
    );
  }
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
      <span className="text-slate-700">Bruto</span>
      <span className="font-medium tabular-nums text-slate-800">
        {fmtCurrency(gross)}
      </span>
    </div>
  );
}
