import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { getStoredUser } from "../services/auth";
import type { BabyVaccineCatalogRow, BabyVaccineReminderItem, BabyVaccineReminders } from "../types";
import { formatBrazilPhone, getWhatsAppUrl } from "../utils/phone";

type Props = {
  reminders: BabyVaccineReminders | null;
  hideContacted: boolean;
  onRemindersChange: (reminders: BabyVaccineReminders) => void;
  onFeedback: (message: string, type: "success" | "error") => void;
};

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatContactedAt(isoDateTime: string) {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return isoDateTime;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function describeTarget(item: BabyVaccineReminderItem) {
  if (item.daysUntilTarget > 0) {
    return `faltam ${item.daysUntilTarget === 1 ? "1 dia" : `${item.daysUntilTarget} dias`}`;
  }
  if (item.daysUntilTarget === 0) {
    return "e hoje";
  }
  return `ha ${Math.abs(item.daysUntilTarget)} dia(s)`;
}

function formatAgeLabel(months: number) {
  if (months < 12) {
    return months === 1 ? "1 mes" : `${months} meses`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearsLabel = years === 1 ? "1 ano" : `${years} anos`;
  return rest ? `${yearsLabel} e ${rest === 1 ? "1 mes" : `${rest} meses`}` : yearsLabel;
}

// Aba "Bebes" da tela Vacinas: maes cujo bebe (nascimento estimado pela DPP) esta
// chegando a uma idade com vacinas do calendario SBIm. Uma mensagem por idade.
export function BabyVaccinesPanel({ reminders, hideContacted, onRemindersChange, onFeedback }: Props) {
  const isAdmin = getStoredUser()?.role === "admin";
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<BabyVaccineCatalogRow[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogBusyId, setCatalogBusyId] = useState<number | null>(null);

  const items = useMemo(
    () => (reminders?.items ?? []).filter((item) => !hideContacted || !item.contacted),
    [reminders, hideContacted]
  );

  const catalogByAge = useMemo(() => {
    const groups = new Map<number, BabyVaccineCatalogRow[]>();
    (catalog ?? []).forEach((row) => {
      groups.set(row.ageMonths, [...(groups.get(row.ageMonths) ?? []), row]);
    });
    return [...groups.entries()];
  }, [catalog]);

  async function handleContact(item: BabyVaccineReminderItem, contacted: boolean) {
    setBusyKey(`${item.patientId}:${item.ageMonths}`);
    try {
      onRemindersChange(await api.setBabyVaccineContact(item.patientId, item.ageMonths, contacted));
      window.dispatchEvent(new Event("vacinas:changed"));
      onFeedback(contacted ? `${item.patientName} marcada como contatada (vacinas de ${item.ageLabel}).` : `Contato de ${item.patientName} desmarcado.`, "success");
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o contato.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleCatalog() {
    const next = !catalogOpen;
    setCatalogOpen(next);
    if (next && !catalog) {
      try {
        setCatalog((await api.getBabyVaccineCatalog()).catalog);
      } catch (error) {
        onFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a lista de vacinas.", "error");
      }
    }
  }

  async function updateCatalogRow(row: BabyVaccineCatalogRow, payload: { availability?: string; active?: boolean }) {
    setCatalogBusyId(row.id);
    try {
      setCatalog((await api.updateBabyVaccineCatalog(row.id, payload)).catalog);
      onRemindersChange(await api.getBabyVaccineReminders());
      window.dispatchEvent(new Event("vacinas:changed"));
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.", "error");
    } finally {
      setCatalogBusyId(null);
    }
  }

  return (
    <>
      <section className="stack-form">
        <div className="form-section-header">
          <p className="muted-label">
            Avisos de vacina do bebe ({items.length}{items.length !== (reminders?.items.length ?? 0) ? ` de ${reminders?.items.length ?? 0}` : ""})
          </p>
          <p className="field-hint">
            Maes encerradas como "Parto realizado". O nascimento e estimado pela DPP; o aviso aparece 15 dias antes de cada idade. Ordenadas pela data mais proxima.
          </p>
        </div>

        {items.length ? (
          <div className="messages-grid">
            {items.map((item) => {
              const whatsappUrl = getWhatsAppUrl(item.phone, encodeURIComponent(item.whatsappMessage));
              const busy = busyKey === `${item.patientId}:${item.ageMonths}`;
              return (
                <article key={`${item.patientId}:${item.ageMonths}`} className="panel-card message-card operational-card">
                  <div className="card-row">
                    <div>
                      <Link to={`/pacientes/${item.patientId}`}><strong>{item.patientName}</strong></Link>
                      <p className="field-hint">{formatBrazilPhone(item.phone) || "Sem telefone"}</p>
                    </div>
                    <div className="card-row-badges">
                      <span className="badge badge-soft badge-priority-blue">Bebe: {item.ageLabel}</span>
                      {item.contacted ? <span className="badge badge-soft badge-priority-green">Contatada</span> : null}
                    </div>
                  </div>

                  <div className="message-metadata">
                    <span><strong>Completa {item.ageLabel} em:</strong> {formatDate(item.targetDate)} ({describeTarget(item)})</span>
                    <span className="field-hint">DPP da mae: {formatDate(item.dpp)}</span>
                  </div>

                  <ul className="baby-vaccine-list">
                    {item.vaccines.map((vaccine) => (
                      <li key={vaccine.id}>
                        <span>{vaccine.vaccineName} <em>– {vaccine.doseLabel}</em></span>
                        <span className={`baby-vaccine-chip ${vaccine.availability === "clinica" ? "is-clinic" : "is-public"}`}>
                          {vaccine.availability === "clinica" ? "MedFetus" : "Posto de saude"}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {item.contacted && item.contactedAt ? (
                    <p className="field-hint">
                      Contatada em {formatContactedAt(item.contactedAt)}{item.contactedByName ? ` por ${item.contactedByName}` : ""}
                    </p>
                  ) : null}

                  <div className="message-actions list-action-bar operational-action-bar">
                    <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleContact(item, !item.contacted)}>
                      {item.contacted ? "Desmarcar contatada" : "Marcar contatada"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">Nenhum aviso de vacina do bebe agora.</p>
        )}
      </section>

      {isAdmin ? (
        <section className="stack-form">
          <div className="card-row">
            <div className="form-section-header">
              <p className="muted-label">Lista de vacinas do bebe (ate 2 anos)</p>
              <p className="field-hint">Defina o que a MedFetus aplica (a mensagem chama para agendar) e o que fica para o posto de saude.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => void toggleCatalog()}>
              {catalogOpen ? "Fechar lista" : "Editar lista"}
            </button>
          </div>

          {catalogOpen ? (
            catalog ? (
              <div className="baby-catalog">
                {catalogByAge.map(([ageMonths, rows]) => (
                  <div key={ageMonths} className="baby-catalog-group">
                    <strong className="baby-catalog-age">{formatAgeLabel(ageMonths)}</strong>
                    {rows.map((row) => (
                      <div key={row.id} className={`baby-catalog-row ${row.active ? "" : "is-inactive"}`}>
                        <span className="baby-catalog-name">{row.vaccineName} <em>– {row.doseLabel}</em></span>
                        <select
                          id={`baby-catalog-availability-${row.id}`}
                          aria-label={`Onde aplicar: ${row.vaccineName} ${row.doseLabel}`}
                          value={row.availability}
                          disabled={catalogBusyId === row.id}
                          onChange={(event) => void updateCatalogRow(row, { availability: event.target.value })}
                        >
                          <option value="clinica">MedFetus aplica</option>
                          <option value="posto">Posto de saude</option>
                        </select>
                        <label className="baby-catalog-active">
                          <input
                            id={`baby-catalog-active-${row.id}`}
                            type="checkbox"
                            checked={row.active}
                            disabled={catalogBusyId === row.id}
                            onChange={(event) => void updateCatalogRow(row, { active: event.target.checked })}
                          />{" "}
                          Avisar
                        </label>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">Carregando lista...</p>
            )
          ) : null}
        </section>
      ) : null}
    </>
  );
}
