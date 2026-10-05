import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ExcelJS from "exceljs";
import { api } from "../services/api";
import type { ContactHistoryQuery, ContactHistoryResponse, ContactHistoryRow } from "../types";

const PAGE_SIZE = 50;
const DEFAULT_PERIOD_DAYS = 30;

// "Hoje" no fuso da clinica (o servidor tambem filtra por dia de Sao Paulo).
function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateBr(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

type Filters = { from: string; to: string; actorUserId: string; type: string };

function defaultFilters(): Filters {
  const to = todayInSaoPaulo();
  return { from: addDaysIso(to, -(DEFAULT_PERIOD_DAYS - 1)), to, actorUserId: "", type: "" };
}

function describeRowDetails(row: ContactHistoryRow) {
  if (row.board === "dtpa") {
    return [row.gestationalAgeLabel ? `IG ${row.gestationalAgeLabel}` : null, row.sectionLabel].filter(Boolean).join(" · ");
  }
  return "";
}

// Aba "Historico de contatos" da Administracao: quem marcou "Contatada" nos
// quadros da tela Vacinas (gestantes dTpa e bebes). Fonte: audit_logs.
export function ContactHistoryPanel() {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toQuery = useCallback((filters: Filters): ContactHistoryQuery => ({
    from: filters.from,
    to: filters.to,
    actorUserId: filters.actorUserId || undefined,
    type: filters.type || undefined
  }), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getContactHistory({ ...toQuery(applied), page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Nao foi possivel carregar o historico.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied, page, toQuery]);

  function applyFilters() {
    setPage(1);
    setApplied({ ...draft });
  }

  function resetFilters() {
    const defaults = defaultFilters();
    setDraft(defaults);
    setPage(1);
    setApplied(defaults);
  }

  async function exportToExcel() {
    setExporting(true);
    setError(null);
    try {
      const full = await api.getContactHistory({ ...toQuery(applied), all: true });
      const workbook = new ExcelJS.Workbook();

      const sheet = workbook.addWorksheet("Contatos");
      sheet.columns = [
        { header: "Data e hora", key: "createdAtLabel", width: 18 },
        { header: "Funcionaria", key: "actorName", width: 26 },
        { header: "Paciente", key: "patientName", width: 32 },
        { header: "Quadro", key: "boardLabel", width: 18 },
        { header: "Detalhe", key: "detail", width: 40 },
        { header: "Acao", key: "actionLabel", width: 16 }
      ];
      full.rows.forEach((row) => sheet.addRow({ ...row, detail: describeRowDetails(row) }));

      const summarySheet = workbook.addWorksheet("Resumo");
      summarySheet.columns = [
        { header: "Funcionaria", key: "actorName", width: 26 },
        { header: "Gestantes (dTpa)", key: "dtpa", width: 18 },
        { header: "Bebes", key: "bebe", width: 12 },
        { header: "Total", key: "total", width: 10 }
      ];
      full.summary.forEach((row) => summarySheet.addRow(row));

      [sheet, summarySheet].forEach((worksheet) => {
        const header = worksheet.getRow(1);
        header.font = { bold: true, color: { argb: "FF203047" } };
        header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FB" } };
        worksheet.views = [{ state: "frozen", ySplit: 1 }];
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `historico-contatos-${applied.from}-a-${applied.to}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Nao foi possivel exportar para Excel.");
    } finally {
      setExporting(false);
    }
  }

  const actors = data?.actors ?? [];
  const appliedActorName = applied.actorUserId ? actors.find((actor) => String(actor.id) === applied.actorUserId)?.name : null;

  return (
    <article className="panel-card stack-form contact-history">
      <div className="card-row">
        <div className="form-section-header">
          <p className="muted-label">Historico de contatos</p>
          <p className="field-hint">
            Quem marcou "Contatada" na tela Vacinas (gestantes dTpa e bebes). A Central de contatos nao entra aqui.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={() => void exportToExcel()} disabled={exporting || !data?.total}>
          {exporting ? "Gerando Excel..." : "Exportar para Excel"}
        </button>
      </div>

      <form
        className="contact-history-filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label>
          De
          <input id="contact-history-from" type="date" value={draft.from} max={draft.to} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label>
          Ate
          <input id="contact-history-to" type="date" value={draft.to} min={draft.from} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <label>
          Funcionaria
          <select id="contact-history-actor" value={draft.actorUserId} onChange={(event) => setDraft({ ...draft, actorUserId: event.target.value })}>
            <option value="">Todas</option>
            {actors.map((actor) => (
              <option key={actor.id} value={String(actor.id)}>
                {actor.name}{actor.active ? "" : " (inativa)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select id="contact-history-type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
            <option value="">Todos</option>
            <option value="dtpa">Gestante dTpa</option>
            <option value="bebe">Bebe</option>
          </select>
        </label>
        <div className="contact-history-filter-actions">
          <button type="submit" className="secondary-button">Filtrar</button>
          <button type="button" className="ghost-button" onClick={resetFilters}>Ultimos 30 dias</button>
        </div>
      </form>

      <p className="field-hint">
        Periodo: {formatDateBr(applied.from)} a {formatDateBr(applied.to)}
        {appliedActorName ? ` · ${appliedActorName}` : ""}
        {applied.type ? ` · ${applied.type === "dtpa" ? "Gestante dTpa" : "Bebe"}` : ""}
        {data ? ` · ${data.total} registro(s)` : ""}
      </p>

      {error ? (
        <div className="form-alert form-alert-error"><span>{error}</span></div>
      ) : null}

      <div className="contact-history-summary">
        {(data?.summary ?? []).length ? (
          data!.summary.map((item) => (
            <div key={`${item.actorUserId ?? item.actorName}`} className="contact-history-summary-card">
              <strong>{item.actorName}</strong>
              <span className="contact-history-summary-total">{item.total}</span>
              <span className="field-hint">contato(s) no periodo</span>
              <div className="contact-history-summary-split">
                <span>Gestantes: <b>{item.dtpa}</b></span>
                <span>Bebes: <b>{item.bebe}</b></span>
              </div>
            </div>
          ))
        ) : (
          <p className="empty-state">{loading ? "Carregando..." : "Nenhum contato registrado nesse periodo."}</p>
        )}
      </div>

      {data?.rows.length ? (
        <div className="clients-table-wrapper">
          <table className="clients-table contact-history-table">
            <thead>
              <tr>
                <th>Data e hora</th>
                <th>Funcionaria</th>
                <th>Paciente</th>
                <th>Quadro</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td className="contact-history-date">{row.createdAtLabel}</td>
                  <td>{row.actorName}</td>
                  <td>
                    {row.patientId ? <Link to={`/pacientes/${row.patientId}`}>{row.patientName}</Link> : row.patientName}
                  </td>
                  <td>
                    <div className="clients-primary-cell">
                      <span>{row.boardLabel}</span>
                      {describeRowDetails(row) ? <span className="field-hint">{describeRowDetails(row)}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-soft ${row.action === "contatada" ? "badge-priority-green" : "badge-priority-orange"}`}>
                      {row.actionLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.totalPages > 1 ? (
        <div className="contact-history-pagination">
          <button type="button" className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Pagina {data.page} de {data.totalPages}</span>
          <button type="button" className="secondary-button" disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)}>Proxima</button>
        </div>
      ) : null}
    </article>
  );
}
