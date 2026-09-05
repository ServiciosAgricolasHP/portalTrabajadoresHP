import { useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import { formatRutForDisplay, normalizeRut } from "../utils/rutUtils.js";
import { bankName, accountTypeLabel } from "../utils/banks.js";
import { fmtCurrency, fmtNumber, fmtTimestamp } from "../utils/formatters.js";

// Mismo formato/paleta que el detalle del trabajador dentro de una nómina en
// adminAgrofrutos (Payroll.jsx → WorkerPaidDetailTables): tablas con
// encabezado celeste (#9dc3e6) para el detalle, durazno (#f8cbad) para el
// resumen de ajustes y verde (#c6efce) para resaltar el neto a pagar —
// mismos colores que usa admin en su propio detalle/imagen exportable.
// Envueltas en overflow-x-auto para que en mobile se puedan deslizar en vez
// de romper el layout, igual que hace admin con las suyas.

const CELL_H = { border: "1px solid #555", padding: "5px 7px", fontSize: 11, fontWeight: 700, textAlign: "left", color: "#000" };
const CELL = { border: "1px solid #999", padding: "4px 7px", fontSize: 11, color: "#000" };
const COLOR_HEAD_CHRONO = "#9dc3e6";
const COLOR_HEAD_SUMMARY = "#f8cbad";
const COLOR_NETO = "#c6efce";
const COLOR_ANTICIPO_BG = "#fce4d6";
const COLOR_BONO_BG = "#dcfce7";
const COLOR_ANTICIPO_TEXT = "#b45309";
const COLOR_BONO_TEXT = "#166534";

const ADVANCE_KIND_META = {
  anticipo: { icon: "🪙", label: "Anticipo", sign: "−", bg: COLOR_ANTICIPO_BG, color: COLOR_ANTICIPO_TEXT },
  bono: { icon: "🎁", label: "Bono", sign: "+", bg: COLOR_BONO_BG, color: COLOR_BONO_TEXT },
};

const WD_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// "2026-05-11" → "11-may" — mismo formato de fecha corta que usa admin en
// su detalle (workerDetailDateLabel en Payroll.jsx).
function dateLabel(d) {
  if (!d) return "";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  return `${m[3]}-${WD_MONTHS[Number(m[2]) - 1] || m[2]}`;
}

// Etiqueta secundaria bajo el nombre de la labor — mismo texto que usa
// admin (laborSubtypeLabel), salvo trato/tratoHE con catálogo (el portal no
// tiene acceso a los catálogos de tipo/unidad, así que usa un genérico).
function laborSubtypeLabel(labor) {
  const t = labor?.type;
  if (t === "cosecha") return "Cosecha";
  if (t === "trato") return "Trato";
  if (t === "tratoEtapas") return "Por etapas";
  if (t === "tratoHE") return "Tratos HE / Jornadas";
  if (t === "main") return "Jornada principal";
  if (t === "supervision") return "Supervisión";
  if (t === "extra") return "Extra";
  return t || "";
}

// Forma de pago legible. Para no exponer la cuenta completa cuando el portal
// es público mostramos solo los últimos 4 dígitos.
function paymentSummary(worker) {
  const bank = String(worker?.bankCode || "").toUpperCase();
  if (!bank || bank === "EFE") return { label: "Efectivo", detail: null, isCash: true };
  const acct = String(worker?.accountNumber || "").trim();
  const last4 = acct ? `····${acct.slice(-4)}` : "";
  const type = accountTypeLabel(worker?.accountType);
  const detail = [type, last4].filter(Boolean).join(" ");
  return { label: bankName(bank), detail: detail || null, isCash: false };
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

// "Lo que hizo ese día" — columna "Producción" del detalle en admin.
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
  if (laborType === "cosecha") return qty > 0 ? `${fmtNumber(qty)} kg` : "—";
  if (laborType === "tratoHE") {
    if (qty <= 0) return "—";
    const parts = [`${fmtNumber(qty)} jornadas`];
    const he = Number(wd?.overtimeHours) || 0;
    if (he > 0) parts.push(`${fmtNumber(he)}h HE`);
    return parts.join(" · ");
  }
  if (laborType === "trato") return qty > 0 ? `${fmtNumber(qty)}` : "—";
  // main / supervision / extra: 1 jornada por día, igual que admin.
  return "1 jornadas";
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
      const fecha = r.date ? dateLabel(r.date) : "s/f";
      if (r.kind === "work") {
        const sub = laborSubtypeLabel(r.labor);
        const det = sub ? `${r.labor.name} (${sub})` : r.labor.name;
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
      const fecha = r.date ? dateLabel(r.date) : "s/f";
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

  const tabBtnStyle = (active) => ({
    border: active ? "1px solid #5b8db8" : "1px solid #ccc",
    background: active ? COLOR_HEAD_CHRONO : "#fff",
    color: "#000",
    fontWeight: active ? 700 : 400,
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
  });

  return (
    <div className="space-y-3">
      <div
        ref={captureRef}
        className="infografia rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[#2f5f8a]">
              {snapshot.payroll?.name || "Nómina"}
            </div>
            <h2 className="mt-0.5 text-lg font-semibold leading-tight text-slate-800 sm:text-xl">
              {worker.name}
            </h2>
            <div className="mt-0.5 font-mono text-sm text-slate-500">
              {formatRutForDisplay(worker.rut)}
            </div>
            {worker.groupLeader && (
              <div className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-[#1f4e79]" style={{ background: COLOR_HEAD_CHRONO }}>
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

        {/* Resumen Bruto / Anticipos / Bonos / Neto — misma tabla y colores
            que el detalle del trabajador en adminAgrofrutos. */}
        <div className="my-4 overflow-x-auto">
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...CELL_H, background: COLOR_HEAD_SUMMARY }}>Bruto</th>
                <th style={{ ...CELL_H, background: COLOR_HEAD_SUMMARY }}>Anticipos</th>
                <th style={{ ...CELL_H, background: COLOR_HEAD_SUMMARY }}>Bonos</th>
                <th style={{ ...CELL_H, background: COLOR_NETO }}>Neto a pagar</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...CELL, fontWeight: 600 }}>{fmtCurrency(gross)}</td>
                <td style={{ ...CELL, color: advance > 0 ? COLOR_ANTICIPO_TEXT : "#999" }}>
                  {advance > 0 ? `− ${fmtCurrency(advance)}` : "—"}
                </td>
                <td style={{ ...CELL, color: bonus > 0 ? COLOR_BONO_TEXT : "#999" }}>
                  {bonus > 0 ? `+ ${fmtCurrency(bonus)}` : "—"}
                </td>
                <td style={{ ...CELL, background: COLOR_NETO, fontWeight: 700, fontSize: 15 }}>
                  {fmtCurrency(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {sections.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Detalle
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setViewMode("cronologico")} style={tabBtnStyle(viewMode === "cronologico")}>
                  Cronológico
                </button>
                <button type="button" onClick={() => setViewMode("porCiclo")} style={tabBtnStyle(viewMode === "porCiclo")}>
                  Por ciclo
                </button>
              </div>
            </div>

            {viewMode === "cronologico" ? (
              <div className="overflow-x-auto">
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ background: COLOR_HEAD_CHRONO }}>
                      <th style={CELL_H}>Fecha</th>
                      <th style={CELL_H}>Detalle</th>
                      <th style={CELL_H}>Contexto</th>
                      <th style={{ ...CELL_H, textAlign: "right" }}>Producción</th>
                      <th style={{ ...CELL_H, textAlign: "right" }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chronoRows.map((r, i) => {
                      if (r.kind === "work") {
                        return (
                          <tr key={r.id || i}>
                            <td style={{ ...CELL, fontFamily: "ui-monospace, monospace" }}>{dateLabel(r.date)}</td>
                            <td style={CELL}>
                              <div>{r.labor.name}</div>
                              <div style={{ fontSize: 9, color: "#777", marginTop: 1 }}>{laborSubtypeLabel(r.labor)}</div>
                            </td>
                            <td style={{ ...CELL, fontSize: 10, color: "#555" }}>{r.context}</td>
                            <td style={{ ...CELL, textAlign: "right" }}>{r.descr || "—"}</td>
                            <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                              {r.amount > 0 ? fmtCurrency(r.amount) : "—"}
                            </td>
                          </tr>
                        );
                      }
                      const meta = ADVANCE_KIND_META[r.kind];
                      return (
                        <tr key={`${r.kind}-${i}`} style={{ background: meta.bg }}>
                          <td style={{ ...CELL, fontFamily: "ui-monospace, monospace" }}>{r.date ? dateLabel(r.date) : "s/f"}</td>
                          <td style={CELL}>
                            <div style={{ fontWeight: 600 }}>{meta.icon} {meta.label}</div>
                          </td>
                          <td style={{ ...CELL, fontSize: 10, color: "#555" }}>{r.note || "—"}</td>
                          <td style={{ ...CELL, textAlign: "right", color: "#999" }}>—</td>
                          <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: meta.color }}>
                            {meta.sign} {fmtCurrency(r.amount)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: COLOR_NETO, fontWeight: 700 }}>
                      <td style={CELL} colSpan={4}>NETO A PAGAR</td>
                      <td style={{ ...CELL, textAlign: "right" }}>{fmtCurrency(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-3">
                {sections.map((sec) => (
                  <div key={sec.cycleId} className="overflow-x-auto">
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#000", marginBottom: 4 }}>
                      {sec.cycle.label || sec.cycleId}
                    </div>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ background: COLOR_HEAD_CHRONO }}>
                          <th style={CELL_H}>Detalle Jornada</th>
                          <th style={CELL_H}>Fecha</th>
                          <th style={{ ...CELL_H, textAlign: "right" }}>Producción</th>
                          <th style={{ ...CELL_H, textAlign: "right" }}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.rows.map((r) => (
                          <tr key={r.id}>
                            <td style={CELL}>
                              <div>{r.labor.name}</div>
                              <div style={{ fontSize: 9, color: "#777", marginTop: 1 }}>{laborSubtypeLabel(r.labor)}</div>
                            </td>
                            <td style={{ ...CELL, fontFamily: "ui-monospace, monospace" }}>{dateLabel(r.date)}</td>
                            <td style={{ ...CELL, textAlign: "right" }}>{r.descr || "—"}</td>
                            <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                              {r.amount > 0 ? fmtCurrency(r.amount) : "—"}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ background: COLOR_NETO, fontWeight: 700 }}>
                          <td style={CELL} colSpan={3}>Subtotal ciclo</td>
                          <td style={{ ...CELL, textAlign: "right" }}>{fmtCurrency(sec.totalAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}

                {hasAdjustments && <AdjustmentsTable rows={[...anticipoRows, ...bonoRows]} total={total} />}
              </div>
            )}
          </section>
        ) : (
          // Snapshots viejos sin workdays — caemos al resumen por ciclo
          <>
            <FallbackByCycle worker={worker} snapshot={snapshot} gross={gross} />
            {hasAdjustments && <AdjustmentsTable rows={[...anticipoRows, ...bonoRows]} total={total} />}
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
        {pay.isCash && (
          <div className="mt-1 px-1 text-[11px] text-amber-700">
            ⚠ El pago en efectivo no tiene una fecha específica de pago.
          </div>
        )}

        <footer className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-400">
          <span>Generado: {fmtTimestamp(snapshot.generatedAt)}</span>
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

// Bloque "Ajustes aplicados" — misma tabla (encabezado durazno, fila final
// verde) que usa admin en su vista "Por ciclo".
function AdjustmentsTable({ rows, total }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ fontSize: 12, fontWeight: 700, color: "#000", marginBottom: 4 }}>Ajustes aplicados</div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ background: COLOR_HEAD_SUMMARY }}>
            <th style={CELL_H}>Tipo</th>
            <th style={CELL_H}>Fecha</th>
            <th style={CELL_H}>Nota</th>
            <th style={{ ...CELL_H, textAlign: "right" }}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const meta = ADVANCE_KIND_META[r.kind];
            return (
              <tr key={i}>
                <td style={{ ...CELL, fontWeight: 600 }}>{meta.icon} {meta.label}</td>
                <td style={{ ...CELL, fontFamily: "ui-monospace, monospace" }}>{r.date ? dateLabel(r.date) : "s/f"}</td>
                <td style={{ ...CELL, fontSize: 10, color: "#555" }}>{r.note || "—"}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: meta.color }}>
                  {meta.sign} {fmtCurrency(r.amount)}
                </td>
              </tr>
            );
          })}
          <tr style={{ background: COLOR_NETO, fontWeight: 700 }}>
            <td style={CELL} colSpan={3}>NETO A PAGAR</td>
            <td style={{ ...CELL, textAlign: "right" }}>{fmtCurrency(total)}</td>
          </tr>
        </tbody>
      </table>
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
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: COLOR_HEAD_CHRONO }}>
              <th style={CELL_H}>Por faena</th>
              <th style={{ ...CELL_H, textAlign: "right" }}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {cycleIds.map((cid) => {
              const entry = byCycle[cid];
              const amt = Number(entry?.amount ?? entry) || 0;
              return (
                <tr key={cid}>
                  <td style={CELL}>{cycleLabels[cid] || cid}</td>
                  <td style={{ ...CELL, textAlign: "right" }}>{fmtCurrency(amt)}</td>
                </tr>
              );
            })}
            <tr style={{ background: COLOR_NETO, fontWeight: 700 }}>
              <td style={CELL}>Bruto</td>
              <td style={{ ...CELL, textAlign: "right" }}>{fmtCurrency(gross)}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
