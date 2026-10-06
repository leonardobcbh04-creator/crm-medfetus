import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BabyVaccinesPanel } from "../components/BabyVaccinesPanel";
import { PageSkeleton } from "../components/PageSkeleton";
import { VsrVaccinesPanel } from "../components/VsrVaccinesPanel";
import { api } from "../services/api";
import type { BabyVaccineReminders, DtpaCampaign, DtpaCampaignItem, VsrCampaign } from "../types";
import { formatBrazilPhone, getWhatsAppUrl } from "../utils/phone";

const HIDE_CONTACTED_STORAGE_KEY = "vacinas.ocultarContatadas";
const ACTIVE_TAB_STORAGE_KEY = "vacinas.abaAtiva";

type VaccinesTab = "gestantes" | "vsr" | "bebes";

function readActiveTabPreference(): VaccinesTab {
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored === "bebes" || stored === "vsr" ? stored : "gestantes";
  } catch {
    return "gestantes";
  }
}

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatShortDate(isoDate: string) {
  const [, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}`;
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

function readHideContactedPreference() {
  try {
    return window.localStorage.getItem(HIDE_CONTACTED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

// Avisa o menu lateral para atualizar o contador de "Vacinas" na hora.
function notifyVaccinesChanged() {
  window.dispatchEvent(new Event("vacinas:changed"));
}

function pluralDays(days: number) {
  return days === 1 ? "1 dia" : `${days} dias`;
}

export function VaccinesPage() {
  const [campaign, setCampaign] = useState<DtpaCampaign | null>(null);
  const [vsrCampaign, setVsrCampaign] = useState<VsrCampaign | null>(null);
  const [babyReminders, setBabyReminders] = useState<BabyVaccineReminders | null>(null);
  const [activeTab, setActiveTab] = useState<VaccinesTab>(readActiveTabPreference);
  const [loading, setLoading] = useState(true);
  const [hideContacted, setHideContacted] = useState(readHideContactedPreference);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");

  const loadCampaign = useCallback(async () => {
    try {
      const [campaignResponse, vsrResponse, babyResponse] = await Promise.all([
        api.getDtpaCampaign(),
        api.getVsrCampaign(),
        api.getBabyVaccineReminders()
      ]);
      setCampaign(campaignResponse);
      setVsrCampaign(vsrResponse);
      setBabyReminders(babyResponse);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a tela de vacinas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  function selectTab(tab: VaccinesTab) {
    setActiveTab(tab);
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
    } catch {
      // Preferencia so do navegador.
    }
  }

  function toggleHideContacted(value: boolean) {
    setHideContacted(value);
    try {
      window.localStorage.setItem(HIDE_CONTACTED_STORAGE_KEY, String(value));
    } catch {
      // Preferencia so do navegador; sem armazenamento, segue com o valor em memoria.
    }
  }

  const visible = useMemo(() => {
    const filter = (items: DtpaCampaignItem[]) => (hideContacted ? items.filter((item) => !item.contacted) : items);
    return {
      entering: filter(campaign?.entering ?? []),
      eligible: filter(campaign?.eligible ?? [])
    };
  }, [campaign, hideContacted]);

  const contactedCount = useMemo(
    () => activeTab === "bebes"
      ? (babyReminders?.items ?? []).filter((item) => item.contacted).length
      : activeTab === "vsr"
        ? (vsrCampaign?.items ?? []).filter((item) => item.contacted).length
        : [...(campaign?.entering ?? []), ...(campaign?.eligible ?? [])].filter((item) => item.contacted).length,
    [activeTab, babyReminders, campaign, vsrCampaign]
  );

  async function handleContact(item: DtpaCampaignItem, contacted: boolean) {
    setBusyKey(`contact-${item.patientId}`);
    setFeedback(null);
    try {
      setCampaign(await api.setDtpaContact(item.patientId, contacted));
      notifyVaccinesChanged();
      setFeedbackType("success");
      setFeedback(contacted ? `${item.patientName} marcada como contatada.` : `Contato de ${item.patientName} desmarcado.`);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o contato.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVaccine(item: DtpaCampaignItem, vaccineCode: "dtpa" | "gripe", status: "tomada" | "nao_se_aplica") {
    const vaccineLabel = vaccineCode === "dtpa" ? "dTpa" : "gripe";
    const statusLabel = status === "tomada" ? "tomada" : "nao se aplica";
    if (vaccineCode === "dtpa" && !window.confirm(`Marcar a dTpa de ${item.patientName} como "${statusLabel}"? Ela sai desta tela.`)) {
      return;
    }
    setBusyKey(`${vaccineCode}-${item.patientId}`);
    setFeedback(null);
    try {
      await api.updatePatientVaccineStatus(item.patientId, vaccineCode, status);
      await loadCampaign();
      notifyVaccinesChanged();
      setFeedbackType("success");
      setFeedback(`Vacina ${vaccineLabel} de ${item.patientName} marcada como "${statusLabel}".`);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.");
    } finally {
      setBusyKey(null);
    }
  }

  function renderItem(item: DtpaCampaignItem) {
    const whatsappUrl = getWhatsAppUrl(item.phone, encodeURIComponent(item.whatsappMessage));
    const busy = busyKey !== null && busyKey.endsWith(`-${item.patientId}`);

    return (
      <article key={item.patientId} className="panel-card message-card operational-card">
        <div className="card-row">
          <div>
            <Link to={`/pacientes/${item.patientId}`}><strong>{item.patientName}</strong></Link>
            <p className="field-hint">{formatBrazilPhone(item.phone) || "Sem telefone"}</p>
          </div>
          <div className="card-row-badges">
            {/* Toda paciente desta tela esta com a dTpa pendente (criterio de entrada). */}
            <span className="badge badge-soft badge-priority-orange">dTpa pendente</span>
            {item.fluPending ? <span className="badge badge-soft badge-priority-orange">Gripe pendente</span> : null}
            {item.contacted ? <span className="badge badge-soft badge-priority-green">Contatada</span> : null}
          </div>
        </div>

        <div className="message-metadata">
          <span><strong>IG atual:</strong> {item.gestationalAgeLabel}</span>
          {item.section === "entrando" && item.windowStartDate && item.daysUntilWindow !== undefined ? (
            <span>
              <strong>Completa 20 semanas em:</strong> {formatDate(item.windowStartDate)} (faltam {pluralDays(item.daysUntilWindow)})
            </span>
          ) : null}
          {item.section === "janela" && item.windowEndDate && item.daysUntilWindowEnd !== undefined ? (
            <span>
              <strong>Janela ate:</strong> {formatDate(item.windowEndDate)} (36s6d
              {item.daysUntilWindowEnd === 0 ? " — ultimo dia" : `, faltam ${pluralDays(item.daysUntilWindowEnd)}`})
            </span>
          ) : null}
          <span>
            <strong>Proximo exame:</strong>{" "}
            {item.nextExam
              ? `${item.nextExam.name} em ${formatShortDate(item.nextExam.scheduledDate)}${item.nextExam.scheduledTime ? ` as ${item.nextExam.scheduledTime}` : ""}`
              : "Nenhum exame agendado"}
          </span>
          {item.agendaVisit ? (
            <span className="field-hint">
              A mensagem convida a aproveitar o horario de {formatShortDate(item.agendaVisit.scheduledDate)}
              {item.agendaVisit.scheduledTime ? ` as ${item.agendaVisit.scheduledTime}` : ""} (agenda importada).
            </span>
          ) : null}
          {item.contacted && item.contactedAt ? (
            <span className="field-hint">
              Contatada em {formatContactedAt(item.contactedAt)}{item.contactedByName ? ` por ${item.contactedByName}` : ""}
            </span>
          ) : null}
        </div>

        <div className="message-actions list-action-bar operational-action-bar">
          <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void handleContact(item, !item.contacted)}
          >
            {item.contacted ? "Desmarcar contatada" : "Marcar contatada"}
          </button>
        </div>

        <div className="vaccine-status-actions">
          <div className="vaccine-status-group">
            <span className="vaccine-status-group-label">dTpa</span>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "dtpa", "tomada")}>
              Tomada
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "dtpa", "nao_se_aplica")}>
              Nao se aplica
            </button>
          </div>
          {item.fluPending ? (
            <div className="vaccine-status-group">
              <span className="vaccine-status-group-label">Gripe</span>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "gripe", "tomada")}>
                Tomada
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void handleVaccine(item, "gripe", "nao_se_aplica")}>
                Nao se aplica
              </button>
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  function renderSection(title: string, description: string, items: DtpaCampaignItem[], total: number, emptyText: string) {
    return (
      <section className="stack-form">
        <div className="form-section-header">
          <p className="muted-label">{title} ({items.length}{items.length !== total ? ` de ${total}` : ""})</p>
          <p className="field-hint">{description}</p>
        </div>
        {items.length ? (
          <div className="messages-grid">{items.map(renderItem)}</div>
        ) : (
          <p className="empty-state">{emptyText}</p>
        )}
      </section>
    );
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">{activeTab === "bebes" ? "Calendario SBIm do bebe" : activeTab === "vsr" ? "Aviso VSR (SUS)" : "Campanha dTpa"}</p>
          <h2>Vacinas</h2>
          <p className="page-description">
            {activeTab === "bebes"
              ? "Maes com bebe chegando a uma idade de vacinacao (ate 2 anos). Uma mensagem por idade: o que a MedFetus aplica e o que fica no posto de saude."
              : activeTab === "vsr"
                ? "Gestantes com a VSR pendente entre 28 e 36 semanas. A vacina e gratuita no SUS: o aviso informa a paciente que ela pode tomar no posto de saude."
                : "Gestantes com a dTpa pendente que ja podem vacinar (20 a 36 semanas) ou que entram na janela nos proximos 15 dias."}
          </p>
        </div>
        <div className="inline-actions">
          <label className="vaccine-filter-toggle">
            <input
              type="checkbox"
              checked={hideContacted}
              onChange={(event) => toggleHideContacted(event.target.checked)}
            />{" "}
            Ocultar contatadas{contactedCount ? ` (${contactedCount})` : ""}
          </label>
        </div>
      </div>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="patient-tabs-bar" role="tablist" aria-label="Tipo de aviso de vacina">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "gestantes"}
          className={`patient-tab-button ${activeTab === "gestantes" ? "active" : ""}`}
          onClick={() => selectTab("gestantes")}
        >
          <span>Gestantes (dTpa)</span>
          <span className="patient-tab-count">{campaign?.summary.notContacted ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "vsr"}
          className={`patient-tab-button ${activeTab === "vsr" ? "active" : ""}`}
          onClick={() => selectTab("vsr")}
        >
          <span>Gestantes (VSR)</span>
          <span className="patient-tab-count">{vsrCampaign?.summary.notContacted ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "bebes"}
          className={`patient-tab-button ${activeTab === "bebes" ? "active" : ""}`}
          onClick={() => selectTab("bebes")}
        >
          <span>Bebes</span>
          <span className="patient-tab-count">{babyReminders?.summary.notContacted ?? 0}</span>
        </button>
      </div>

      {activeTab === "vsr" ? (
        <VsrVaccinesPanel
          campaign={vsrCampaign}
          hideContacted={hideContacted}
          onCampaignChange={setVsrCampaign}
          onReload={loadCampaign}
          onFeedback={(message, type) => {
            setFeedbackType(type);
            setFeedback(message);
          }}
        />
      ) : activeTab === "bebes" ? (
        <BabyVaccinesPanel
          reminders={babyReminders}
          hideContacted={hideContacted}
          onRemindersChange={setBabyReminders}
          onFeedback={(message, type) => {
            setFeedbackType(type);
            setFeedback(message);
          }}
        />
      ) : (
      <>
      {renderSection(
        "Entram na janela nos proximos 15 dias",
        "Completam 20 semanas nos proximos 15 dias. Ordenadas por quem entra primeiro.",
        visible.entering,
        campaign?.entering.length ?? 0,
        "Nenhuma paciente entra na janela nos proximos 15 dias."
      )}

      {renderSection(
        "Ja podem vacinar",
        "Entre 20s0d e 36s6d hoje. Ordenadas por quem esta mais perto de sair da janela.",
        visible.eligible,
        campaign?.eligible.length ?? 0,
        "Nenhuma paciente na janela da dTpa agora."
      )}
      </>
      )}
    </section>
  );
}
