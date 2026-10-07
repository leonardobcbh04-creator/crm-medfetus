import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";
import { PageSkeleton } from "../components/PageSkeleton";
import { getStoredUser } from "../services/auth";
import type { PatientDetails, PatientExamRecord } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";
import { formatBrazilPhone, getWhatsAppUrl } from "../utils/phone";

// Ficha da paciente em versao enxuta: cabecalho com os dados principais, cartao
// "Agora" com o proximo exame, linha do tempo compacta (uma linha por exame; as
// acoes aparecem ao clicar) e coluna lateral com dados e vacinas.

type PatientDetailTab = "resumo" | "historico";
type ExamAction = "agendar" | "realizar" | "externo";
type DotColor = "verde" | "amarelo" | "laranja" | "vermelho" | "cinza";

function formatGestationalAge(details: PatientDetails) {
  const { gestationalWeeks, gestationalDays, gestationalAgeLabel } = details.patient;
  if (gestationalWeeks === null || gestationalWeeks === undefined) {
    return gestationalAgeLabel || "-";
  }
  return `${gestationalWeeks}s${gestationalDays ?? 0}d`;
}

function examDotColor(exam: PatientExamRecord): DotColor {
  if (exam.status === "realizado" || exam.timelineStatus === "superado") return "cinza";
  if (exam.status === "agendado") return "verde";
  if (exam.showOperationalAlert || exam.deadlineStatus === "atrasado") return "vermelho";
  if (exam.deadlineStatus === "pendente") return "laranja";
  if (exam.deadlineStatus === "aproximando") return "amarelo";
  return "verde";
}

function describeSchedule(exam: PatientExamRecord) {
  if (!exam.scheduledDateLabel) return "";
  return `${exam.scheduledDateLabel}${exam.scheduledTime ? ` às ${exam.scheduledTime}` : ""}`;
}

function examStatusChip(exam: PatientExamRecord) {
  if (exam.status === "realizado") {
    return exam.completedOutsideClinic
      ? { label: "Historico anterior", tone: "neutral" }
      : { label: `Realizado${exam.completedDateLabel ? ` ${exam.completedDateLabel}` : ""}`, tone: "neutral" };
  }
  if (exam.status === "agendado") return { label: `Agendado ${describeSchedule(exam)}`.trim(), tone: "success" };
  if (exam.timelineStatus === "superado") return { label: "Etapa superada", tone: "neutral" };
  if (exam.showOperationalAlert) return { label: "Atrasado", tone: "danger" };
  return { label: `Previsto ${exam.predictedDateLabel}`, tone: "info" };
}

function formatHistoryDate(value: string | null | undefined) {
  if (!value) return "Sem data";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildExamRecordMaps(exams: PatientExamRecord[]) {
  const pick = (field: (exam: PatientExamRecord) => string | null | undefined) =>
    exams.reduce<Record<number, string>>((accumulator, exam) => {
      accumulator[exam.id] = field(exam) || "";
      return accumulator;
    }, {});
  return {
    scheduledDates: pick((exam) => exam.scheduledDate),
    scheduledTimes: pick((exam) => exam.scheduledTime),
    schedulingNotes: pick((exam) => exam.schedulingNotes),
    completedDates: pick((exam) => exam.completedDate)
  };
}

export function PatientDetailPage() {
  const { id } = useParams();
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"error" | "success">("success");
  const [activeTab, setActiveTab] = useState<PatientDetailTab>("resumo");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [openExamId, setOpenExamId] = useState<number | null>(null);
  const [examAction, setExamAction] = useState<{ examId: number; action: ExamAction; where: "agora" | "linha" } | null>(null);
  const [savingExamId, setSavingExamId] = useState<number | null>(null);
  const [invalidField, setInvalidField] = useState<"scheduledDate" | "scheduledTime" | "completedDate" | null>(null);
  const [scheduledDates, setScheduledDates] = useState<Record<number, string>>({});
  const [scheduledTimes, setScheduledTimes] = useState<Record<number, string>>({});
  const [schedulingNotes, setSchedulingNotes] = useState<Record<number, string>>({});
  const [completedDates, setCompletedDates] = useState<Record<number, string>>({});
  const [isClosingTracking, setIsClosingTracking] = useState(false);
  const [isSavingClosure, setIsSavingClosure] = useState(false);
  const [isReopeningTracking, setIsReopeningTracking] = useState(false);
  const [closureReasonDraft, setClosureReasonDraft] = useState("");
  const [savingVaccineCode, setSavingVaccineCode] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }
    void loadPatientDetails(Number(id));
  }, [id]);

  function applyDetails(response: PatientDetails) {
    setDetails(response);
    const maps = buildExamRecordMaps(response.exams);
    setScheduledDates(maps.scheduledDates);
    setScheduledTimes(maps.scheduledTimes);
    setSchedulingNotes(maps.schedulingNotes);
    setCompletedDates(maps.completedDates);
  }

  async function loadPatientDetails(patientId: number) {
    setLoading(true);
    try {
      applyDetails(await api.getPatientDetails(patientId));
    } finally {
      setLoading(false);
    }
  }

  function showFeedback(type: "error" | "success", message: string) {
    setFeedbackType(type);
    setFeedback(message);
  }

  async function handleConfirmCloseTracking() {
    if (!id || !closureReasonDraft) {
      return;
    }
    setIsSavingClosure(true);
    try {
      setDetails(await api.closePatientTracking(Number(id), closureReasonDraft));
      setIsClosingTracking(false);
      setClosureReasonDraft("");
      showFeedback("success", "Acompanhamento encerrado. A paciente nao vai mais receber mensagens ou lembretes automaticos.");
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "Nao foi possivel encerrar o acompanhamento.");
    } finally {
      setIsSavingClosure(false);
    }
  }

  // Perda gestacional: encerra o acompanhamento na hora (sem passar pelo menu de
  // motivos) para a paciente parar de receber qualquer mensagem ou lembrete.
  async function handleRegisterPregnancyLoss() {
    if (!id || !details) {
      return;
    }
    const confirmed = window.confirm(
      `Registrar perda gestacional de ${details.patient.name}?\n\n` +
      "Ela sai de todas as telas de contato e nao recebe mais mensagens nem lembretes (exames e vacinas). " +
      "O historico fica guardado e da para reabrir se tiver sido engano."
    );
    if (!confirmed) {
      return;
    }
    setIsSavingClosure(true);
    try {
      setDetails(await api.closePatientTracking(Number(id), "perda_gestacional"));
      setIsClosingTracking(false);
      setClosureReasonDraft("");
      showFeedback("success", "Perda gestacional registrada. A paciente nao vai mais receber mensagens ou lembretes.");
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "Nao foi possivel registrar a perda gestacional.");
    } finally {
      setIsSavingClosure(false);
    }
  }

  async function handleReopenTracking() {
    if (!id) {
      return;
    }
    setIsReopeningTracking(true);
    try {
      setDetails(await api.reopenPatientTracking(Number(id)));
      showFeedback("success", "Acompanhamento reativado. A paciente volta a aparecer no fluxo de atendimento.");
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "Nao foi possivel reativar o acompanhamento.");
    } finally {
      setIsReopeningTracking(false);
    }
  }

  async function handleExamStatusUpdate(
    examId: number,
    status: "agendado" | "realizado" | "pendente",
    options?: { completedOutsideClinic?: boolean }
  ) {
    if (!id) {
      return;
    }
    const completedOutsideClinic = Boolean(options?.completedOutsideClinic);

    if (status === "agendado" && !scheduledDates[examId]) {
      setInvalidField("scheduledDate");
      showFeedback("error", "Informe a data do agendamento.");
      return;
    }
    if (status === "agendado" && !scheduledTimes[examId]) {
      setInvalidField("scheduledTime");
      showFeedback("error", "Informe o horario do agendamento.");
      return;
    }
    if (status === "realizado" && !completedOutsideClinic && !completedDates[examId]) {
      setInvalidField("completedDate");
      showFeedback("error", "Informe a data de realizacao do exame.");
      return;
    }

    setInvalidField(null);
    setSavingExamId(examId);
    setFeedback("");
    try {
      const response = await api.updatePatientExamStatus(Number(id), examId, {
        status,
        scheduledDate: scheduledDates[examId] || null,
        scheduledTime: scheduledTimes[examId] || null,
        schedulingNotes: schedulingNotes[examId] || null,
        actorUserId: getStoredUser()?.id ?? null,
        completedDate: completedDates[examId] || null,
        completedOutsideClinic
      });
      applyDetails(response.patient);
      setExamAction(null);
      showFeedback(
        "success",
        status === "realizado"
          ? completedOutsideClinic
            ? "Exame registrado como ja realizado e fluxo recalculado."
            : "Exame marcado como realizado e fluxo recalculado."
          : status === "agendado"
            ? "Agendamento registrado com sucesso."
            : "Exame voltou para acompanhamento."
      );
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
    } finally {
      setSavingExamId(null);
    }
  }

  async function handleVaccineStatusUpdate(vaccineCode: string, status: "pendente" | "tomada" | "nao_se_aplica") {
    if (!id) {
      return;
    }
    setSavingVaccineCode(vaccineCode);
    setFeedback("");
    try {
      const response = await api.updatePatientVaccineStatus(Number(id), vaccineCode, status);
      setDetails((current) =>
        current ? { ...current, patient: { ...current.patient, vaccineNeeds: response.vaccineNeeds } } : current
      );
      showFeedback("success", "Status da vacina atualizado.");
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.");
    } finally {
      setSavingVaccineCode(null);
    }
  }

  if (loading) {
    return <PageSkeleton cards={4} />;
  }

  if (!details) {
    return <p className="loading-text">Paciente nao encontrada.</p>;
  }

  const patient = details.patient;
  const isClosed = patient.status === "encerrada";
  const priority = getPatientPriorityMeta(patient);
  const timelineItems = [...details.exams].sort((left, right) =>
    String(left.predictedDate || "").localeCompare(String(right.predictedDate || ""))
  );
  const upcomingExams = timelineItems.filter((exam) => exam.status !== "realizado");
  const overdueCode = patient.nextExam.overdueExam?.code;
  const nextCode = patient.nextExam.code;
  const currentExam =
    (overdueCode ? details.exams.find((exam) => exam.code === overdueCode) : null) ||
    (nextCode ? details.exams.find((exam) => exam.code === nextCode) : null) ||
    upcomingExams[0] ||
    null;
  const pastExams = timelineItems.filter((exam) => exam.timelineStatus === "superado" && exam.id !== currentExam?.id);
  const mainExams = timelineItems.filter((exam) => !pastExams.includes(exam));
  // O intervalo (ex.: "janela 24 a 28 semanas") vem do proximo exame do protocolo.
  const [, nextExamWindow] = patient.nextExam.dateLabel && currentExam?.code === nextCode
    ? patient.nextExam.dateLabel.split(" • ")
    : [null, null];

  const whatsappUrl = getWhatsAppUrl(
    patient.phone,
    encodeURIComponent(
      patient.nextExam.suggestedMessage ||
        `Ola, ${patient.name}. Tudo bem? Aqui e da clinica obstetrica. ` +
          `Estamos entrando em contato sobre seu proximo exame: ${patient.nextExam.name}. ` +
          "Se quiser, podemos ajudar com o agendamento."
    )
  );

  const historyItems = [
    ...details.messages.map((message) => ({
      key: `m-${message.id}`,
      date: message.sentAt || message.responseAt || "",
      what:
        `Mensagem ${message.deliveryStatus === "enviada" ? "enviada" : message.deliveryStatus}` +
        (message.responseStatus === "respondida" ? " · respondida" : ""),
      detail: message.content,
      who: ""
    })),
    ...details.movements.map((movement) => ({
      key: `f-${movement.id}`,
      date: movement.createdAt,
      what: movement.description || movement.actionType,
      detail: "",
      who: ""
    })),
    ...details.auditLogs.map((log) => ({
      key: `a-${log.id}`,
      date: log.createdAt,
      what: log.description,
      detail: "",
      who: log.actorUserName || ""
    }))
  ].sort((left, right) => String(right.date).localeCompare(String(left.date)));

  // where = "agora": o formulario abre no cartao "Agora" (acoes do cabecalho e do
  // proprio cartao); "linha": abre na linha do exame na linha do tempo.
  function startExamAction(examId: number, action: ExamAction, where: "agora" | "linha") {
    setExamAction({ examId, action, where });
    setInvalidField(null);
    setMenuOpen(false);
    setActiveTab("resumo");
    if (where === "linha") {
      setOpenExamId(examId);
      if (pastExams.some((exam) => exam.id === examId)) {
        setPastOpen(true);
      }
    }
  }

  function renderExamForm(exam: PatientExamRecord) {
    if (examAction?.examId !== exam.id) {
      return null;
    }
    const saving = savingExamId === exam.id;
    const cancel = () => {
      setExamAction(null);
      setInvalidField(null);
    };

    if (examAction.action === "agendar") {
      return (
        <div className="ficha-exam-form">
          <div className="ficha-form-grid">
            <label>
              Data do agendamento
              <input
                type="date"
                className={invalidField === "scheduledDate" ? "field-input-error" : ""}
                value={scheduledDates[exam.id] || ""}
                onChange={(event) => setScheduledDates((current) => ({ ...current, [exam.id]: event.target.value }))}
              />
            </label>
            <label>
              Horario
              <input
                type="time"
                className={invalidField === "scheduledTime" ? "field-input-error" : ""}
                value={scheduledTimes[exam.id] || ""}
                onChange={(event) => setScheduledTimes((current) => ({ ...current, [exam.id]: event.target.value }))}
              />
            </label>
          </div>
          <label>
            Observacoes (opcional)
            <textarea
              rows={2}
              value={schedulingNotes[exam.id] || ""}
              onChange={(event) => setSchedulingNotes((current) => ({ ...current, [exam.id]: event.target.value }))}
              placeholder="Ex.: prefere periodo da tarde, levar pedido medico."
            />
          </label>
          <div className="ficha-form-actions">
            <button type="button" className="primary-button" disabled={saving} onClick={() => void handleExamStatusUpdate(exam.id, "agendado")}>
              {saving ? "Salvando..." : "Confirmar agendamento"}
            </button>
            <button type="button" className="ghost-button" disabled={saving} onClick={cancel}>Cancelar</button>
          </div>
        </div>
      );
    }

    if (examAction.action === "realizar") {
      return (
        <div className="ficha-exam-form">
          <div className="ficha-form-grid">
            <label>
              Data em que foi realizado
              <input
                type="date"
                className={invalidField === "completedDate" ? "field-input-error" : ""}
                value={completedDates[exam.id] || ""}
                onChange={(event) => setCompletedDates((current) => ({ ...current, [exam.id]: event.target.value }))}
              />
            </label>
          </div>
          <div className="ficha-form-actions">
            <button type="button" className="primary-button" disabled={saving} onClick={() => void handleExamStatusUpdate(exam.id, "realizado")}>
              {saving ? "Salvando..." : "Confirmar realizacao"}
            </button>
            <button type="button" className="ghost-button" disabled={saving} onClick={cancel}>Cancelar</button>
          </div>
        </div>
      );
    }

    return (
      <div className="ficha-exam-form">
        <p className="field-hint">Registrar que este exame ja foi feito (fora da clinica ou antes do cadastro)? O fluxo e recalculado.</p>
        <div className="ficha-form-actions">
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() => void handleExamStatusUpdate(exam.id, "realizado", { completedOutsideClinic: true })}
          >
            {saving ? "Salvando..." : "Confirmar"}
          </button>
          <button type="button" className="ghost-button" disabled={saving} onClick={cancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  function renderExamActions(exam: PatientExamRecord) {
    const saving = savingExamId === exam.id;
    if (exam.status === "realizado") {
      return (
        <div className="ficha-exam-actions">
          <button type="button" className="ficha-action-button" disabled={saving} onClick={() => void handleExamStatusUpdate(exam.id, "pendente")}>
            {saving ? "Salvando..." : "Desfazer realizado"}
          </button>
        </div>
      );
    }
    return (
      <div className="ficha-exam-actions">
        <button type="button" className="ficha-action-button" onClick={() => startExamAction(exam.id, "agendar", "linha")}>
          {exam.status === "agendado" ? "Remarcar" : "Registrar agendamento"}
        </button>
        <button type="button" className="ficha-action-button" onClick={() => startExamAction(exam.id, "realizar", "linha")}>Marcar como realizado</button>
        <button type="button" className="ficha-action-button" onClick={() => startExamAction(exam.id, "externo", "linha")}>Ja realizado (fora)</button>
        {exam.status === "agendado" ? (
          <button type="button" className="ficha-action-button" disabled={saving} onClick={() => void handleExamStatusUpdate(exam.id, "pendente")}>
            Cancelar agendamento
          </button>
        ) : null}
        <a
          className="ficha-text-link"
          href={getWhatsAppUrl(
            patient.phone,
            encodeURIComponent(exam.suggestedMessage || `Ola, ${patient.name}. Podemos ajudar com o agendamento do exame ${exam.name}?`)
          )}
          target="_blank"
          rel="noreferrer"
        >
          Enviar mensagem
        </a>
      </div>
    );
  }

  function renderExamRow(exam: PatientExamRecord) {
    const open = openExamId === exam.id;
    const chip = examStatusChip(exam);
    const isCurrent = currentExam?.id === exam.id;
    return (
      <div key={exam.id} className={`ficha-exam ${isCurrent ? "is-current" : ""}`}>
        <button
          type="button"
          className="ficha-exam-row"
          aria-expanded={open}
          onClick={() => {
            setOpenExamId(open ? null : exam.id);
            if (open) setExamAction(null);
          }}
        >
          <span className={`funnel-dot funnel-dot-${examDotColor(exam)}`} aria-hidden="true" />
          <span className="ficha-exam-text">
            <span className="ficha-exam-name">{exam.name}</span>
            <span className="ficha-muted">
              {isCurrent ? "Proximo exame · " : ""}Data ideal {exam.predictedDateLabel}
            </span>
          </span>
          <span className={`ficha-chip ficha-chip-${chip.tone}`}>{chip.label}</span>
        </button>
        {open ? (
          <div className="ficha-exam-body">
            {exam.schedulingNotes ? <p className="ficha-muted">Obs.: {exam.schedulingNotes}</p> : null}
            {exam.status === "realizado" && exam.completedByName ? (
              <p className="ficha-muted">Registrado por {exam.completedByName}</p>
            ) : null}
            {exam.status === "agendado" && exam.scheduledByName ? (
              <p className="ficha-muted">Agendado por {exam.scheduledByName}</p>
            ) : null}
            {examAction?.examId === exam.id && examAction.where === "linha" ? renderExamForm(exam) : renderExamActions(exam)}
          </div>
        ) : null}
      </div>
    );
  }

  const vaccines = patient.vaccineNeeds || [];

  return (
    <section className="page-section ficha-page">
      <header className="ficha-header">
        <div className="ficha-header-main">
          <Link to="/clientes" className="ficha-back">‹ Pacientes</Link>
          <h2>{patient.name}</h2>
          <div className="ficha-facts">
            <span><strong>{formatGestationalAge(details)}</strong> de gestacao</span>
            <span>DPP <strong>{patient.estimatedDueDate}</strong></span>
            <span>{formatBrazilPhone(patient.phone) || "Sem telefone"}</span>
            {patient.physicianName ? <span>{patient.physicianName}</span> : null}
            {patient.clinicUnit ? <span>{patient.clinicUnit}</span> : null}
          </div>
          {patient.gestationalReviewRequired || patient.gestationalBaseIsEstimated || patient.highRisk ? (
            <div className="ficha-flags">
              {patient.highRisk ? <span className="ficha-chip ficha-chip-danger">Alto risco</span> : null}
              {patient.gestationalReviewRequired ? <span className="ficha-chip ficha-chip-danger">Revisao da base</span> : null}
              {patient.gestationalBaseIsEstimated ? <span className="ficha-chip ficha-chip-info">Idade gestacional estimada</span> : null}
            </div>
          ) : null}
        </div>
        <div className="ficha-header-actions">
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="funnel-whatsapp ficha-whatsapp">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20l1.3-5.1A8.4 8.4 0 1 1 21 11.5z" />
            </svg>
            WhatsApp
          </a>
          {!isClosed && currentExam ? (
            <button type="button" className="ficha-outline-button" onClick={() => startExamAction(currentExam.id, "agendar", "agora")}>
              Registrar agendamento
            </button>
          ) : null}
          <div className="ficha-menu-wrap">
            <button type="button" className="ficha-menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              Mais acoes
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="ficha-menu" role="menu">
                <Link role="menuitem" className="ficha-menu-item" to={`/pacientes/${patient.id}/editar`}>Editar dados da paciente</Link>
                {!isClosed && currentExam ? (
                  <button type="button" role="menuitem" className="ficha-menu-item" onClick={() => startExamAction(currentExam.id, "realizar", "agora")}>
                    Registrar exame realizado
                  </button>
                ) : null}
                {!isClosed ? (
                  <>
                    <div className="ficha-menu-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="ficha-menu-item"
                      onClick={() => {
                        setIsClosingTracking(true);
                        setMenuOpen(false);
                      }}
                    >
                      Encerrar acompanhamento
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="ficha-menu-item ficha-menu-danger"
                      disabled={isSavingClosure}
                      onClick={() => {
                        setMenuOpen(false);
                        void handleRegisterPregnancyLoss();
                      }}
                    >
                      Encerrar como perda gestacional
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <strong>{feedbackType === "error" ? "Atenção" : "Sucesso"}</strong>
          <span>{feedback}</span>
        </div>
      ) : null}

      {isClosed ? (
        <div className="form-alert form-alert-error">
          <strong>Acompanhamento encerrado{patient.closureReasonLabel ? ` - ${patient.closureReasonLabel}` : ""}</strong>
          <span>Esta paciente nao aparece mais no fluxo de atendimento, na central de contatos nem nos lembretes automaticos.</span>
          <button type="button" className="secondary-button" disabled={isReopeningTracking} onClick={() => void handleReopenTracking()}>
            {isReopeningTracking ? "Reativando..." : "Reativar acompanhamento"}
          </button>
        </div>
      ) : isClosingTracking ? (
        <div className="ficha-card">
          <p className="ficha-card-title">Encerrar acompanhamento</p>
          <p className="field-hint">
            A paciente para de receber mensagens e lembretes automaticos e sai do fluxo de atendimento e da central de contatos.
            O historico continua acessivel por aqui.
          </p>
          <label className="ficha-close-field">
            Motivo
            <select value={closureReasonDraft} onChange={(event) => setClosureReasonDraft(event.target.value)}>
              <option value="">Selecione um motivo</option>
              <option value="perda_gestacional">Perda gestacional</option>
              <option value="parto_realizado">Parto realizado</option>
              <option value="transferencia">Transferencia para outro servico</option>
              <option value="desistencia">Desistencia do acompanhamento</option>
            </select>
          </label>
          <div className="ficha-form-actions">
            <button type="button" className="primary-button" disabled={!closureReasonDraft || isSavingClosure} onClick={() => void handleConfirmCloseTracking()}>
              {isSavingClosure ? "Salvando..." : "Confirmar encerramento"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={isSavingClosure}
              onClick={() => {
                setIsClosingTracking(false);
                setClosureReasonDraft("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="ficha-tabs" role="tablist" aria-label="Secoes da ficha">
        <button type="button" role="tab" aria-selected={activeTab === "resumo"} className={`ficha-tab ${activeTab === "resumo" ? "active" : ""}`} onClick={() => setActiveTab("resumo")}>
          Resumo
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "historico"} className={`ficha-tab ${activeTab === "historico" ? "active" : ""}`} onClick={() => setActiveTab("historico")}>
          Historico ({historyItems.length})
        </button>
      </div>

      {activeTab === "resumo" ? (
        <div className="ficha-layout">
          <div className="ficha-main">
            <article className="ficha-card">
              <div className="ficha-card-head">
                <span className="ficha-card-title">Agora</span>
                {!isClosed ? (
                  <span className={`funnel-stage-chip funnel-stage-chip-${patient.stage}`}>Etapa: {patient.stageTitle || patient.stage}</span>
                ) : null}
              </div>
              {currentExam ? (
                <>
                  <div className="ficha-now">
                    <span className={`funnel-dot funnel-dot-${examDotColor(currentExam)} ficha-now-dot`} title={priority.label} aria-label={priority.label} role="img" />
                    <div>
                      <div className="ficha-now-name">{currentExam.name}</div>
                      <div className="ficha-now-status">
                        {currentExam.status === "agendado"
                          ? <strong>Agendado para {describeSchedule(currentExam)}</strong>
                          : currentExam.showOperationalAlert
                            ? <strong className="ficha-text-danger">Passou do intervalo e ainda nao foi realizado</strong>
                            : <strong>{priority.label}</strong>}
                      </div>
                      <div className="ficha-muted">
                        {nextExamWindow ? `${nextExamWindow.charAt(0).toUpperCase()}${nextExamWindow.slice(1)} · ` : ""}data ideal {currentExam.predictedDateLabel}
                      </div>
                    </div>
                  </div>
                  {!isClosed ? (
                    examAction?.examId === currentExam.id && examAction.where === "agora"
                      ? renderExamForm(currentExam)
                      : (
                        <div className="ficha-exam-actions">
                          <button type="button" className="ficha-action-button" onClick={() => startExamAction(currentExam.id, "agendar", "agora")}>
                            {currentExam.status === "agendado" ? "Remarcar" : "Registrar agendamento"}
                          </button>
                          <button type="button" className="ficha-action-button" onClick={() => startExamAction(currentExam.id, "realizar", "agora")}>
                            Marcar como realizado
                          </button>
                        </div>
                      )
                  ) : null}
                </>
              ) : (
                <p className="ficha-muted">Todos os exames do protocolo ja foram realizados.</p>
              )}
            </article>

            <article className="ficha-card">
              <div className="ficha-card-head">
                <span className="ficha-card-title">Linha do tempo</span>
                <span className="ficha-muted">Clique num exame para ver as acoes</span>
              </div>
              {pastExams.length ? (
                <>
                  <button type="button" className="ficha-exam-row ficha-past-toggle" aria-expanded={pastOpen} onClick={() => setPastOpen(!pastOpen)}>
                    <span className="funnel-dot funnel-dot-cinza" aria-hidden="true" />
                    <span className="ficha-exam-name">
                      {pastExams.length === 1 ? "1 etapa anterior" : `${pastExams.length} etapas anteriores`} · {pastOpen ? "esconder" : "ver"}
                    </span>
                  </button>
                  {pastOpen ? <div className="ficha-past-list">{pastExams.map(renderExamRow)}</div> : null}
                </>
              ) : null}
              {mainExams.length ? mainExams.map(renderExamRow) : <p className="ficha-muted">Nenhum exame encontrado.</p>}
            </article>
          </div>

          <aside className="ficha-side">
            <article className="ficha-card">
              <span className="ficha-card-title">Dados da paciente</span>
              <dl className="ficha-data">
                <dt>Telefone</dt><dd>{formatBrazilPhone(patient.phone) || "Nao informado"}</dd>
                <dt>ID da clinica</dt><dd>{patient.clinicPatientId || "Nao informado"}</dd>
                <dt>Nascimento</dt><dd>{patient.birthDate || "Nao informado"}</dd>
                <dt>Medico</dt><dd>{patient.physicianName || "Nao informado"}</dd>
                <dt>Unidade</dt><dd>{patient.clinicUnit || "Nao informada"}</dd>
                <dt>Gestacao</dt><dd>{patient.pregnancyType || "Nao informada"} · {patient.highRisk ? "alto risco" : "risco habitual"}</dd>
                <dt>DPP</dt><dd>{patient.estimatedDueDate}</dd>
              </dl>
            </article>

            <article className="ficha-card">
              <span className="ficha-card-title">Vacinas</span>
              {vaccines.length ? (
                <div className="ficha-vaccines">
                  {vaccines.map((vaccine) => {
                    const saving = savingVaccineCode === vaccine.code;
                    const chip = vaccine.status === "tomada"
                      ? { label: "Tomada", tone: "success" }
                      : vaccine.status === "nao_se_aplica"
                        ? { label: "Nao se aplica", tone: "neutral" }
                        : !vaccine.actionable
                          ? { label: "Aviso (SUS)", tone: "info" }
                          : { label: "Pendente", tone: "warning" };
                    return (
                      <div key={vaccine.code} className="ficha-vaccine">
                        <div className="ficha-vaccine-head">
                          <span className="ficha-vaccine-name">{vaccine.name}</span>
                          <span className={`ficha-chip ficha-chip-${chip.tone}`}>{chip.label}</span>
                        </div>
                        {vaccine.status === "pendente" && !vaccine.actionable ? (
                          <span className="ficha-muted">Oferecida no posto de saude</span>
                        ) : null}
                        <div className="ficha-vaccine-actions">
                          {vaccine.status === "pendente" ? (
                            <>
                              <button type="button" className="ficha-small-button" disabled={saving} onClick={() => void handleVaccineStatusUpdate(vaccine.code, "tomada")}>
                                {saving ? "Salvando..." : "Tomada"}
                              </button>
                              <button type="button" className="ficha-small-button" disabled={saving} onClick={() => void handleVaccineStatusUpdate(vaccine.code, "nao_se_aplica")}>
                                Nao se aplica
                              </button>
                            </>
                          ) : (
                            <button type="button" className="ficha-small-button" disabled={saving} onClick={() => void handleVaccineStatusUpdate(vaccine.code, "pendente")}>
                              {saving ? "Salvando..." : "Voltar para pendente"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="ficha-muted">Sem dados de vacina para esta paciente.</p>
              )}
            </article>
          </aside>
        </div>
      ) : (
        <article className="ficha-card">
          {historyItems.length ? (
            <ul className="ficha-history">
              {historyItems.map((item) => (
                <li key={item.key}>
                  <span className="ficha-history-date">{formatHistoryDate(item.date)}</span>
                  <span className="ficha-history-text">
                    <strong>{item.what}</strong>
                    {item.who ? ` · ${item.who}` : ""}
                    {item.detail ? <span className="ficha-muted ficha-history-detail">{item.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ficha-muted">Nenhum registro ainda.</p>
          )}
        </article>
      )}
    </section>
  );
}
