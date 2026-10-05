import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { VsrCampaign, VsrCampaignItem } from "../types";
import { formatBrazilPhone, getWhatsAppUrl } from "../utils/phone";

type Props = {
  campaign: VsrCampaign | null;
  hideContacted: boolean;
  onCampaignChange: (campaign: VsrCampaign) => void;
  onReload: () => Promise<void>;
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

// Aba "Gestantes (VSR)" da tela Vacinas: lista unica de 28s0d a 36s6d com a VSR
// pendente. A vacina e do SUS; a mensagem so avisa a paciente.
export function VsrVaccinesPanel({ campaign, hideContacted, onCampaignChange, onReload, onFeedback }: Props) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const items = useMemo(
    () => (campaign?.items ?? []).filter((item) => !hideContacted || !item.contacted),
    [campaign, hideContacted]
  );

  async function handleContact(item: VsrCampaignItem, contacted: boolean) {
    setBusyId(item.patientId);
    try {
      onCampaignChange(await api.setVsrContact(item.patientId, contacted));
      window.dispatchEvent(new Event("vacinas:changed"));
      onFeedback(contacted ? `${item.patientName} marcada como contatada (VSR).` : `Contato de ${item.patientName} desmarcado.`, "success");
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o contato.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleVaccine(item: VsrCampaignItem, status: "tomada" | "nao_se_aplica") {
    const statusLabel = status === "tomada" ? "tomada" : "nao se aplica";
    if (!window.confirm(`Marcar a VSR de ${item.patientName} como "${statusLabel}"? Ela sai desta lista.`)) {
      return;
    }
    setBusyId(item.patientId);
    try {
      await api.updatePatientVaccineStatus(item.patientId, "vsr", status);
      await onReload();
      window.dispatchEvent(new Event("vacinas:changed"));
      onFeedback(`Vacina VSR de ${item.patientName} marcada como "${statusLabel}".`, "success");
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.", "error");
    } finally {
      setBusyId(null);
    }
  }

  const total = campaign?.items.length ?? 0;

  return (
    <section className="stack-form">
      <div className="form-section-header">
        <p className="muted-label">Ja podem tomar a VSR ({items.length}{items.length !== total ? ` de ${total}` : ""})</p>
        <p className="field-hint">
          Entre 28s0d e 36s6d hoje, com a VSR pendente. A vacina e gratuita no SUS (a MedFetus nao aplica): a mensagem so avisa
          que ela pode tomar no posto de saude. Ordenadas por quem esta mais perto de sair do periodo.
        </p>
      </div>

      {items.length ? (
        <div className="messages-grid">
          {items.map((item) => {
            const whatsappUrl = getWhatsAppUrl(item.phone, encodeURIComponent(item.whatsappMessage));
            const busy = busyId === item.patientId;
            return (
              <article key={item.patientId} className="panel-card message-card operational-card">
                <div className="card-row">
                  <div>
                    <Link to={`/pacientes/${item.patientId}`}><strong>{item.patientName}</strong></Link>
                    <p className="field-hint">{formatBrazilPhone(item.phone) || "Sem telefone"}</p>
                  </div>
                  <div className="card-row-badges">
                    <span className="badge badge-soft badge-priority-blue">VSR (SUS)</span>
                    {item.contacted ? <span className="badge badge-soft badge-priority-green">Contatada</span> : null}
                  </div>
                </div>

                <div className="message-metadata">
                  <span><strong>IG atual:</strong> {item.gestationalAgeLabel}</span>
                  <span>
                    <strong>Periodo ate:</strong> {formatDate(item.windowEndDate)} (36s6d
                    {item.daysUntilWindowEnd === 0 ? " — ultimo dia" : `, faltam ${item.daysUntilWindowEnd === 1 ? "1 dia" : `${item.daysUntilWindowEnd} dias`}`})
                  </span>
                  {item.contacted && item.contactedAt ? (
                    <span className="field-hint">
                      Contatada em {formatContactedAt(item.contactedAt)}{item.contactedByName ? ` por ${item.contactedByName}` : ""}
                    </span>
                  ) : null}
                </div>

                <div className="message-actions list-action-bar operational-action-bar">
                  <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a>
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleContact(item, !item.contacted)}>
                    {item.contacted ? "Desmarcar contatada" : "Marcar contatada"}
                  </button>
                </div>

                <div className="vaccine-status-actions">
                  <div className="vaccine-status-group">
                    <span className="vaccine-status-group-label">VSR</span>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "tomada")}>
                      Tomada
                    </button>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "nao_se_aplica")}>
                      Nao se aplica
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-state">{total ? "Todas as pacientes desta lista ja foram contatadas." : "Nenhuma paciente no periodo da VSR agora."}</p>
      )}
    </section>
  );
}
