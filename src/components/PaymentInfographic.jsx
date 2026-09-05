import { useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import { formatRutForDisplay, normalizeRut } from "../utils/rutUtils.js";
import { bankName, accountTypeLabel } from "../utils/banks.js";
import {
  fmtCurrency,
  fmtDateLong,
  fmtDateShort,
  fmtNumber,
  fmtTimestamp,
} from "../utils/formatters.js";

// Mismo formato/orden que el detalle del trabajador dentro de una nómina en
// adminAgrofrutos (Payroll.jsx → WorkerPaidDetailTables): vista cronológica
// por defecto con anticipos/bonos intercalados por fecha, vista alternativa
// "Por ciclo" con subtotal + bloque de ajustes al final, y arriba un resumen
// Bruto / Anticipos / Bonos / Neto. Acá se arma como tarjetas en vez de
// tablas anchas, porque el portal es mobile-first.

const LABOR_TYPE_LABEL = {
  cosecha: "cosecha",
  trato: "a trato",
  tratoEtapas: "por etapas",
  tratoHE: "jornadas",
  main: "al día",
  supervision: "supervisión",
  extra: "adicional",
};

const ADVANCE_KIND_META = {
  anticipo: { icon: "🪙", label: "Anticipo", sign: "−" },
  bono: { icon: "🎁", label: "Bono", sign: "+" },
};

// Forma de pago legible. Para no exponer la cuenta completa cuando el portal
// es público mostramos solo los últimos 4 dígitos.
function paymentSummary(worker) {
  const bank = String(worker?.bankCode || "").toUpperCase();
  if (!bank || bank === "EFE") return { label: "Efectivo", detail: null };
  const acct = String(worker?.accountNumber || "").trim();
  const last4 = acct ? `····${acct.slice(-4)}` : "";
  const type = accountTypeLabel(worker?.accountType);
  const detail = [type, last4].filter(Boolean).join(" ");
  return { label: bankName(bank), detail: detail || null };
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

// "Lo que hizo ese día" — texto corto al lado de la fecha (columna
// "Producción" del detalle en admin). Vacío para labores al día.
function workdayDescription(wd, labor) {
  if (wd?.attendanceOnly) return "presente";
  const qty = workdayQty(wd);
  const laborType = labor?.type;
  if (laborType === "tratoEtapas") {
    const stage = (labor?.stages || []).find(
      (s) => String(s.id) === String(wd?.stageId),
    );
    if (qty <= 0) return stage?.name || "";
    return stage?.name ? `${stage.name} · ${fmtNumber(qty)}` : `${fmtNumber(qty)}`;
  }
  if (qty <= 0) return "";
  if (laborType === "cosecha") return `${fmtNumber(qty)} kg`;
  if (laborType === "tratoHE") {
    const parts = [`${fmtNumber(qty)} jornadas`];
    const he = Number(wd?.overtimeHours) || 0;
    if (he > 0) parts.push(`${fmtNumber(he)}h HE`);
    return parts.join(" · ");
  }
  if (laborType === "trato") return `${fmtNumber(qty)}`;
  return "";
}

// Agrupa los workdays del trabajador por ciclo, con el mismo "contexto"
// (faena / subfaena / ciclo) que usa admin en la columna Contexto.
function buildCycleSections(snapshot, workerRut) {
  const targetRut = normalizeRut(workerRut);
  const wds = (snapshot?.workdays || []).filter(
    (wd) => normalizeRut(wd.workerRut) === targetRut,
  );
  if (wds.length === 0) return [];

  const cyclesById = new Map((snapshot?.cycles || []).map((c) => [c.id, c]));
  const grouped = new Map();
  for (const wd of wds) {
    if (!grouped.has(wd.cycleId)) grouped.set(wd.cycleId, []);
    grouped.get(wd.cycleId).push(wd);
  }

  const sections = [...grouped.entries()].map(([cycleId, list]) => {
    const cycle = cyclesById.get(cycleId) || { id: cycleId, label: cycleId, labors: [] };
    const laborsById = new Map((cycle.labors || []).map((l) => [l.id, l]));
    const rows = list
      .map((wd) => {
        const labor = laborsById.get(wd.laborId) || {
          id: wd.laborId,
          name: wd.laborId,
          type: "main",
        };
        return {
          id: wd.id,
          date: wd.date || "",
          labor,
          descr: workdayDescription(wd, labor),
          amount: Number(wd.amount) || 0,
        };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const context = [cycle.faenaName, cycle.subfaenaName, cycle.label || cycle.id]
      .filter(Boolean)
      .join(" · ");
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    return { cycleId, cycle, context, rows, totalAmount };
  });

  const order = new Map((snapshot?.cycles || []).map((c, i) => [c.id, i]));
  sections.sort((a, b) => (order.get(a.cycleId) ?? 999) - (order.get(b.cycleId) ?? 999));
  return sections;
}

// Anticipos/bonos aplicados en esta nómina, con fecha y nota resueltas
// contra el array `advances` del snapshot — mismo cruce que hace admin.
function buildAdjustmentRows(snapshot, worker) {
  const advancesById = new Map((snapshot?.advances || []).map((a) => [a.id, a]));
  const build = (kind, applications) =>
    (applications || [])
      .map((app) => {
        const adv = advancesById.get(app.advanceId);
        return {
          kind,
          date: adv?.date || "",
          amount: Number(app.amount) || 0,
          note: adv?.note || "",
        };
      })
      .filter((r) => r.amount > 0);
  return {
    anticipos: build("anticipo", worker.anticipoApplications),
    bonos: build("bono", worker.bonoApplications),
  };
}

// Vista cronológica: jornadas + ajustes en una sola línea de tiempo, igual
// que el default de admin. Ajustes sin fecha (snapshots viejos) van al final.
function buildChronoRows(sections, anticipos, bonos) {
  const KIND_ORDER = { work: 0, anticipo: 1, bono: 2 };
  const rows = [];
  for (const sec of sections) {
    for (const r of sec.rows) {
      rows.push({ kind: "work", date: r.date, context: sec.context, labor: r.labor, descr: r.descr, amount: r.amount, id: r.id });
    }
  }
  for (const a of anticipos) rows.push(a);
  for (const b of bonos) rows.push(b);
  rows.sort((a, b) => {
    const da = a.date || "9999-12-31";
    const db = b.date || "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
  });
  return rows;
}

function buildPlainText({ snapshot, worker, sections, anticipoRows, bonoRows, chronoRows }) {
  const lines = [];
  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const bonus = Number(worker.bonus) || 0;
  const gross = Number(worker.grossAmount) || total + advance - bonus;

  lines.push(`*${snapshot.payroll?.name || "Nómina"}*`);
  lines.push(`Trabajador: ${worker.name}`);
  lines.push(`RUT: ${formatRutForDisplay(worker.rut)}`);
  if (worker.groupLeader) lines.push(`Grupo: ${worker.groupLeader}`);
  lines.push("");
  lines.push(
    `Bruto: ${fmtCurrency(gross)} · Anticipos: -${fmtCurrency(advance)} · Bonos: +${fmtCurrency(bonus)} · Neto: ${fmtCurrency(total)}`,
  );
  lines.push("");

  if (sections.length > 0) {
    for (const r of chronoRows) {
      const fecha = r.date ? fmtDateShort(r.date) : "s/f";
      if (r.kind === "work") {
        const typeLabel = LABOR_TYPE_LABEL[r.labor.type] || r.labor.type || "";
        const det = typeLabel ? `${r.labor.name} (${typeLabel})` : r.labor.name;
        const right = r.amount > 0 ? fmtCurrency(r.amount) : "—";
        lines.push(`${fecha} · ${det}${r.descr ? ` · ${r.descr}` : ""} — ${right}`);
      } else {
        const meta = ADVANCE_KIND_META[r.kind];
        lines.push(
          `${fecha} · ${meta.icon} ${meta.label}${r.note ? ` (${r.note})` : ""} — ${meta.sign}${fmtCurrency(r.amount)}`,
        );
      }
    }
  } else {
    // Fallback: solo resumen por ciclo (snapshots viejos sin workdays)
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
    for (const r of [...anticipoRows, ...bonoRows]) {
      const meta = ADVANCE_KIND_META[r.kind];
      const fecha = r.date ? fmtDateShort(r.date) : "s/f";
      lines.push(`${fecha} · ${meta.icon} ${meta.label}${r.note ? ` (${r.note})` : ""} — ${meta.sign}${fmtCurrency(r.amount)}`);
    }
  }

  lines.push("");
  lines.push(`*Neto a pagar: ${fmtCurrency(total)}*`);

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
  const [viewMode, setViewMode] = useState("cronologico");

  const sections = useMemo(
    () => buildCycleSections(snapshot, worker.rut),
    [snapshot, worker.rut],
  );
  const { anticipos: anticipoRows, bonos: bonoRows } = useMemo(
    () => buildAdjustmentRows(snapshot, worker),
    [snapshot, worker],
  );
  const chronoRows = useMemo(
    () => buildChronoRows(sections, anticipoRows, bonoRows),
    [sections, anticipoRows, bonoRows],
  );

  const total = Number(worker.amount) || 0;
  const advance = Number(worker.advance) || 0;
  const bonus = Number(worker.bonus) || 0;
  const gross = Number(worker.grossAmount) || total + advance - bonus;
  const pay = paymentSummary(worker);
  const hasAdjustments = anticipoRows.length > 0 || bonoRows.length > 0;

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
      const text = buildPlainText({ snapshot, worker, sections, anticipoRows, bonoRows, chronoRows });
      await navigator.clipboard.writeText(text);
      showFlash("Texto copiado");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo copiar el texto");
    } finally {
      setBusy(null);
    }
  };

  const tabBtn = (active) =>
    `rounded-md border px-2.5 py-1 text-[11px] ${
      active
        ? "border-teal-700 bg-teal-700 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

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

        {/* Resumen Bruto / Anticipos / Bonos / Neto — mismo orden y colores
            que la tabla de resumen del detalle en adminAgrofrutos. */}
        <div className="my-5 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
          <div className="bg-teal-700 px-4 py-4 text-white">
            <div className="text-[11px] uppercase tracking-wide text-teal-100">
              Neto a pagar
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
              {fmtCurrency(total)}
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50 text-center">
            <div className="px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Bruto</div>
              <div className="mt-0.5 text-xs font-medium tabular-nums text-slate-700">
                {fmtCurrency(gross)}
              </div>
            </div>
            <div className="px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Anticipos</div>
              <div className={`mt-0.5 text-xs font-medium tabular-nums ${advance > 0 ? "text-amber-700" : "text-slate-300"}`}>
                {advance > 0 ? `− ${fmtCurrency(advance)}` : "—"}
              </div>
            </div>
            <div className="px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Bonos</div>
              <div className={`mt-0.5 text-xs font-medium tabular-nums ${bonus > 0 ? "text-emerald-700" : "text-slate-300"}`}>
                {bonus > 0 ? `+ ${fmtCurrency(bonus)}` : "—"}
              </div>
            </div>
          </div>
        </div>

        {sections.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Detalle
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setViewMode("cronologico")} className={tabBtn(viewMode === "cronologico")}>
                  Cronológico
                </button>
                <button type="button" onClick={() => setViewMode("porCiclo")} className={tabBtn(viewMode === "porCiclo")}>
                  Por ciclo
                </button>
              </div>
            </div>

            {viewMode === "cronologico" ? (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {chronoRows.map((r, i) => {
                  if (r.kind === "work") {
                    const typeLabel = LABOR_TYPE_LABEL[r.labor.type] || r.labor.type || "";
                    return (
                      <li key={r.id || i} className="flex items-start justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700">
                            {r.labor.name}
                            {typeLabel && <span className="ml-1 text-slate-400">· {typeLabel}</span>}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {fmtDateShort(r.date)}
                            {r.descr ? ` · ${r.descr}` : ""}
                          </div>
                          {r.context && (
                            <div className="mt-0.5 truncate text-[10px] text-slate-400">{r.context}</div>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums text-slate-700">
                          {r.amount > 0 ? fmtCurrency(r.amount) : "—"}
                        </span>
                      </li>
                    );
                  }
                  const meta = ADVANCE_KIND_META[r.kind];
                  const isAnticipo = r.kind === "anticipo";
                  return (
                    <li
                      key={`${r.kind}-${i}`}
                      className={`flex items-start justify-between gap-2 px-3 py-2 text-xs ${isAnticipo ? "bg-amber-50" : "bg-emerald-50"}`}
                    >
                      <div className="min-w-0">
                        <div className={`font-medium ${isAnticipo ? "text-amber-800" : "text-emerald-800"}`}>
                          {meta.icon} {meta.label}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {r.date ? fmtDateShort(r.date) : "s/f"}
                          {r.note ? ` · ${r.note}` : ""}
                        </div>
                      </div>
                      <span className={`shrink-0 font-medium tabular-nums ${isAnticipo ? "text-amber-900" : "text-emerald-900"}`}>
                        {meta.sign} {fmtCurrency(r.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="space-y-3">
                {sections.map((sec) => (
                  <article key={sec.cycleId} className="overflow-hidden rounded-lg border border-slate-200">
                    <header className="flex items-baseline justify-between gap-3 bg-slate-50 px-3 py-2">
                      <span className="text-sm font-medium text-slate-800">
                        {sec.cycle.label || sec.cycleId}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {fmtCurrency(sec.totalAmount)}
                      </span>
                    </header>
                    <ul className="divide-y divide-slate-100 px-3 py-1">
                      {sec.rows.map((r) => {
                        const typeLabel = LABOR_TYPE_LABEL[r.labor.type] || r.labor.type || "";
                        return (
                          <li key={r.id} className="flex items-baseline justify-between gap-2 py-1 text-[11px] text-slate-600">
                            <span>
                              <span className="text-slate-500">{fmtDateShort(r.date)}</span>
                              <span className="ml-1 text-slate-700">
                                {r.labor.name}
                                {typeLabel ? ` · ${typeLabel}` : ""}
                              </span>
                              {r.descr && <span className="ml-1 text-slate-400">({r.descr})</span>}
                            </span>
                            <span className="tabular-nums text-slate-700">
                              {r.amount > 0 ? fmtCurrency(r.amount) : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                ))}

                {hasAdjustments && (
                  <article className="overflow-hidden rounded-lg border border-slate-200">
                    <header className="bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                      Ajustes aplicados
                    </header>
                    <ul className="divide-y divide-slate-100 px-3 py-1">
                      {[...anticipoRows, ...bonoRows].map((r, i) => {
                        const meta = ADVANCE_KIND_META[r.kind];
                        const isAnticipo = r.kind === "anticipo";
                        return (
                          <li key={i} className="flex items-baseline justify-between gap-2 py-1 text-[11px]">
                            <span className={isAnticipo ? "text-amber-800" : "text-emerald-800"}>
                              {meta.icon} {meta.label}
                              {r.date ? ` · ${fmtDateShort(r.date)}` : ""}
                              {r.note ? ` · ${r.note}` : ""}
                            </span>
                            <span className={`tabular-nums font-medium ${isAnticipo ? "text-amber-900" : "text-emerald-900"}`}>
                              {meta.sign} {fmtCurrency(r.amount)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                )}
              </div>
            )}
          </section>
        ) : (
          // Snapshots viejos sin workdays — caemos al resumen por ciclo
          <>
            <FallbackByCycle worker={worker} snapshot={snapshot} gross={gross} />
            {hasAdjustments && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {[...anticipoRows, ...bonoRows].map((r, i) => {
                  const meta = ADVANCE_KIND_META[r.kind];
                  const isAnticipo = r.kind === "anticipo";
                  return (
                    <li
                      key={i}
                      className={`flex items-baseline justify-between gap-2 px-3 py-2 text-xs ${isAnticipo ? "bg-amber-50" : "bg-emerald-50"}`}
                    >
                      <span className={isAnticipo ? "text-amber-800" : "text-emerald-800"}>
                        {meta.icon} {meta.label}
                        {r.date ? ` · ${fmtDateShort(r.date)}` : ""}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                      <span className={`font-medium tabular-nums ${isAnticipo ? "text-amber-900" : "text-emerald-900"}`}>
                        {meta.sign} {fmtCurrency(r.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
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
