import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";
import { getStoredUser } from "../services/auth";
import type { PatientDetails } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";

type PatientDetailTab = "resumo" | "exames" | "historico";

function getTrimesterMeta(predictedDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(predictedDate);
  if (!match) {
    return {
      label: "Fase nao definida",
      className: "badge-trimester-second"
    };
  }

  return {
    label: "Fase da gestacao",
    className: "badge-trimester-second"
  };
}

function getExamTrimesterMeta(exam: PatientDetails["exams"][number]) {
  if (exam.code === "exame_obstetrico_inicial" || exam.code === "morfologico_1_trimestre" || exam.code === "obstetrica_sexo") {
    return {
      label: "1o trimestre",
      className: "badge-trimester-first"
    };
  }

  if (exam.code === "morfologico_2_trimestre" || exam.code === "doppler_obstetrico" || exam.code === "ecocardiograma_fetal") {
    return {
      label: "2o trimestre",
      className: "badge-trimester-second"
    };
  }

  if (exam.code === "perfil_biofisico_fetal" || exam.code === "morfologico_3_trimestre") {
    return {
      label: "3o trimestre",
      className: "badge-trimester-third"
    };
  }

  return getTrimesterMeta(exam.predictedDate);
}

function getTimelineActionMeta(exam: PatientDetails["exams"][number]) {
  if (exam.status === "realizado") {
    return { label: "OK", text: "Exame realizado", className: "timeline-icon-done" };
  }

  if (exam.status === "agendado") {
    return { label: "AG", text: "Exame agendado", className: "timeline-icon-scheduled" };
  }

  if (exam.shouldHaveBeenDone) {
    return { label: "!", text: "Exame atrasado", className: "timeline-icon-alert" };
  }

  return { label: "EX", text: "Exame previsto", className: "timeline-icon-planned" };
}

export function PatientDetailPage() {
  const { id } = useParams();
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"error" | "success">("success");
  const [activeTab, setActiveTab] = useState<PatientDetailTab>("resumo");
  const [savingExamId, setSavingExamId] = useState<number | null>(null);
  const [confirmingScheduledExamId, setConfirmingScheduledExamId] = useState<number | null>(null);
  const [confirmingRealizedExamId, setConfirmingRealizedExamId] = useState<number | null>(null);
  const [invalidScheduleFields, setInvalidScheduleFields] = useState<Record<number, { scheduledDate: boolean; scheduledTime: boolean }>>({});
  const [invalidCompletedDateExamId, setInvalidCompletedDateExamId] = useState<number | null>(null);
  const [scheduledDates, setScheduledDates] = useState<Record<number, string>>({});
  const [scheduledTimes, setScheduledTimes] = useState<Record<number, string>>({});
  const [schedulingNotes, setSchedulingNotes] = useState<Record<number, string>>({});
  const [completedDates, setCompletedDates] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!id) {
      return;
    }

    loadPatientDetails(Number(id));
  }, [id]);

  async function loadPatientDetails(patientId: number) {
    setLoading(true);
    try {
      const response = await api.getPatientDetails(patientId);
      setDetails(response);
      setScheduledDates(
        response.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.scheduledDate || "";
          return accumulator;
        }, {})
      );
      setScheduledTimes(
        response.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.scheduledTime || "";
          return accumulator;
        }, {})
      );
      setSchedulingNotes(
        response.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.schedulingNotes || "";
          return accumulator;
        }, {})
      );
      setCompletedDates(
        response.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.completedDate || "";
          return accumulator;
        }, {})
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleExamStatusUpdate(examId: number, status: "agendado" | "realizado" | "pendente") {
    if (!id) {
      return;
    }

    if (status === "agendado" && !scheduledDates[examId]) {
      setInvalidScheduleFields((current) => ({
        ...current,
        [examId]: { scheduledDate: true, scheduledTime: !scheduledTimes[examId] }
      }));
      setFeedbackType("error");
      setFeedback("Informe a data do agendamento.");
      return;
    }

    if (status === "agendado" && !scheduledTimes[examId]) {
      setInvalidScheduleFields((current) => ({
        ...current,
        [examId]: { scheduledDate: false, scheduledTime: true }
      }));
      setFeedbackType("error");
      setFeedback("Informe o horario do agendamento.");
      return;
    }

    if (status === "realizado" && !completedDates[examId]) {
      setInvalidCompletedDateExamId(examId);
      setFeedbackType("error");
      setFeedback("Informe a data de realizacao do exame.");
      return;
    }

    setInvalidScheduleFields((current) => ({
      ...current,
      [examId]: { scheduledDate: false, scheduledTime: false }
    }));
    if (status === "realizado") {
      setInvalidCompletedDateExamId(null);
    }
    setSavingExamId(examId);
    setFeedbackType("success");
    setFeedback("");

    try {
      const storedUser = getStoredUser();
      const response = await api.updatePatientExamStatus(Number(id), examId, {
        status,
        scheduledDate: scheduledDates[examId] || null,
        scheduledTime: scheduledTimes[examId] || null,
        schedulingNotes: schedulingNotes[examId] || null,
        actorUserId: storedUser?.id ?? null,
        completedDate: completedDates[examId] || null
      });
      setDetails(response.patient);
      setScheduledDates(
        response.patient.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.scheduledDate || "";
          return accumulator;
        }, {})
      );
      setScheduledTimes(
        response.patient.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.scheduledTime || "";
          return accumulator;
        }, {})
      );
      setSchedulingNotes(
        response.patient.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.schedulingNotes || "";
          return accumulator;
        }, {})
      );
      setCompletedDates(
        response.patient.exams.reduce<Record<number, string>>((accumulator, exam) => {
          accumulator[exam.id] = exam.completedDate || "";
          return accumulator;
        }, {})
      );
      setFeedback(
        status === "realizado"
          ? "Exame marcado como realizado e proximo fluxo recalculado."
          : status === "agendado"
            ? "Exame agendado com sucesso."
            : "Exame voltou para acompanhamento pendente."
      );
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
    } finally {
      setSavingExamId(null);
    }
  }

  if (loading) {
    return <p className="loading-text">Carregando detalhes da paciente...</p>;
  }

  if (!details) {
    return <p className="loading-text">Paciente nao encontrada.</p>;
  }

  const priority = getPatientPriorityMeta(details.patient);
  const upcomingExams = details.exams.filter((exam) => exam.status !== "realizado");
  const completedExams = details.exams.filter((exam) => exam.status === "realizado");
  const gestationalProgressPercent = Math.min(
    100,
    Math.max(0, ((details.patient.gestationalWeeks || 0) / 40) * 100)
  );
  const timelineItems = [...details.exams].sort((left, right) => {
    const leftDate = left.predictedDate || "";
    const rightDate = right.predictedDate || "";
    return leftDate.localeCompare(rightDate);
  });
  const historyItemsCount = details.messages.length + details.movements.length;
  const overdueCode = details.patient.nextExam.overdueExam?.code;
  const nextCode = details.patient.nextExam.code;
  const currentTimelineExamId = overdueCode
    ? details.exams.find((exam) => exam.code === overdueCode)?.id ?? null
    : nextCode
      ? details.exams.find((exam) => exam.code === nextCode)?.id ?? null
      : upcomingExams[0]?.id ?? null;
  const whatsappMessage = encodeURIComponent(
    `Ola, ${details.patient.name}. Tudo bem? Aqui e da clinica obstetrica. ` +
    `Estamos entrando em contato sobre seu proximo exame: ${details.patient.nextExam.name}. ` +
    `${details.patient.nextExam.idealDate ? `A data ideal e ${details.patient.nextExam.idealDate}. ` : ""}` +
    `Se quiser, podemos ajudar com o agendamento.`
  );
  const whatsappUrl = `https://wa.me/${details.patient.phone}?text=${whatsappMessage}`;

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Paciente</p>
          <h2>{details.patient.name}</h2>
          <p className="page-description">
            Visao completa com exames previstos, mensagens registradas e historico operacional.
          </p>
        </div>
        <div className="inline-actions list-action-bar detail-action-bar">
          <Link to={`/pacientes/${details.patient.id}/editar`} className="secondary-button">Editar paciente</Link>
          <button type="button" className="secondary-button" onClick={() => setActiveTab("exames")}>Registrar agendamento</button>
          <button type="button" className="secondary-button" onClick={() => setActiveTab("exames")}>Marcar exame realizado</button>
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="whatsapp-link">Abrir WhatsApp</a>
          <Link to="/kanban" className="secondary-button">Voltar ao Pipeline</Link>
        </div>
      </div>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <strong>{feedbackType === "error" ? "Atenção" : "Sucesso"}</strong>
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="patient-tabs-bar" role="tablist" aria-label="Abas da paciente">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "resumo"}
          className={`patient-tab-button ${activeTab === "resumo" ? "active" : ""}`}
          onClick={() => setActiveTab("resumo")}
        >
          <span>Resumo</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "exames"}
          className={`patient-tab-button ${activeTab === "exames" ? "active" : ""}`}
          onClick={() => setActiveTab("exames")}
        >
          <span>Exames</span>
          <span className="patient-tab-count">{details.exams.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "historico"}
          className={`patient-tab-button ${activeTab === "historico" ? "active" : ""}`}
          onClick={() => setActiveTab("historico")}
        >
          <span>Historico</span>
          <span className="patient-tab-count">{historyItemsCount}</span>
        </button>
      </div>

      <div className="patient-tab-panel">
        {activeTab === "resumo" ? (
          <div className="detail-layout">
        <article className={`panel-card patient-summary-card ${priority.cardClassName} ${priority.needsImmediateAction ? "patient-card-immediate" : ""}`}>
          <p className="muted-label">Status atual</p>
          <div className="priority-badge-row">
            <span className={`badge ${priority.badgeClassName}`}>{priority.label}</span>
            <span className={`badge badge-soft ${priority.badgeClassName}`}>{priority.badgeText}</span>
            {priority.needsImmediateAction ? <span className="badge badge-attention">Acao imediata</span> : null}
          </div>
          <div className="message-metadata">
            <span><strong>Proximo exame:</strong> {details.patient.nextExam.name}</span>
            <span><strong>Classificacao do exame:</strong> {details.patient.nextExam.required ? "Obrigatorio" : "Recomendado"}</span>
            <span><strong>Janela atual:</strong> {details.patient.nextExam.deadlineStatusLabel || "Nao definida"}</span>
            <span><strong>Status:</strong> {details.patient.status || "ativa"}</span>
            <span><strong>Coluna atual:</strong> {details.patient.stageTitle || details.patient.stage}</span>
            {details.patient.nextExam.overdueExam ? (
              <span className="exam-warning-text"><strong>Exame atrasado:</strong> {details.patient.nextExam.overdueExam.name}</span>
            ) : null}
          </div>
        </article>

        <article className="panel-card">
          <p className="muted-label">Dados cadastrais</p>
          <div className="message-metadata">
            <span><strong>Nome completo:</strong> {details.patient.name}</span>
            <span><strong>Telefone:</strong> {details.patient.phone}</span>
            <span><strong>Data de nascimento:</strong> {details.patient.birthDate || "Nao informada"}</span>
            <span><strong>Medico solicitante:</strong> {details.patient.physicianName || "Nao informado"}</span>
            <span><strong>Unidade:</strong> {details.patient.clinicUnit || "Nao informada"}</span>
          </div>
        </article>

        <article className="panel-card">
          <p className="muted-label">Dados gestacionais</p>
          <div className="message-metadata">
            <span><strong>DUM:</strong> {details.patient.dum || "Nao informada"}</span>
            <span><strong>DPP:</strong> {details.patient.estimatedDueDate}</span>
            <span><strong>Idade gestacional:</strong> {details.patient.gestationalAgeLabel}</span>
            <span><strong>Tipo de gestacao:</strong> {details.patient.pregnancyType || "Nao informado"}</span>
            <span><strong>Alto risco:</strong> {details.patient.highRisk ? "Sim" : "Nao"}</span>
          </div>
        </article>

        <article className="panel-card">
          <p className="muted-label">Observacoes</p>
          <p className="admin-notes-text">{details.patient.notes || "Sem observacoes."}</p>
        </article>

        <article className="panel-card timeline-card">
          <p className="muted-label">Linha do tempo da gestacao</p>
          <div className="gestation-band-wrapper">
            <div
              className="gestation-band-current"
              style={{ left: `calc(${gestationalProgressPercent}% - 18px)` }}
            >
              <span>{details.patient.gestationalWeeks || 0} sem</span>
            </div>
            <div className="gestation-band-current-line" style={{ left: `${gestationalProgressPercent}%` }} />
            <div className="gestation-band">
              <div className="gestation-band-segment gestation-band-first">
                <strong>1o trimestre</strong>
                <span>0 a 13 semanas</span>
              </div>
              <div className="gestation-band-segment gestation-band-second">
                <strong>2o trimestre</strong>
                <span>14 a 27 semanas</span>
              </div>
              <div className="gestation-band-segment gestation-band-third">
                <strong>3o trimestre</strong>
                <span>28 semanas em diante</span>
              </div>
            </div>
          </div>
          <div className="timeline-list">
            {timelineItems.length ? timelineItems.map((exam) => (
              <div
                key={exam.id}
                className={`timeline-item ${currentTimelineExamId === exam.id ? "timeline-item-current" : ""} ${exam.shouldHaveBeenDone ? "timeline-item-overdue" : ""}`}
              >
                <div className={`timeline-marker ${getExamTrimesterMeta(exam).className}`} />
                <div className="timeline-content">
                  <div className="card-row">
                    <div className="timeline-title-row">
                      <span className={`timeline-status-icon ${getTimelineActionMeta(exam).className}`}>
                        {getTimelineActionMeta(exam).label}
                      </span>
                      <div>
                        <strong>{exam.name}</strong>
                        <p className="timeline-subtitle">{getTimelineActionMeta(exam).text}</p>
                      </div>
                    </div>
                    <div className="priority-badge-row">
                      {currentTimelineExamId === exam.id ? (
                        <span className="badge badge-attention">Momento atual</span>
                      ) : null}
                      <span className={`badge ${getExamTrimesterMeta(exam).className}`}>
                        {getExamTrimesterMeta(exam).label}
                      </span>
                      <span className={`badge ${
                        exam.status === "realizado"
                          ? "badge-priority-green"
                          : exam.deadlineStatus === "atrasado"
                            ? "badge-priority-red"
                            : exam.deadlineStatus === "pendente"
                              ? "badge-priority-orange"
                              : exam.deadlineStatus === "aproximando"
                                ? "badge-priority-yellow"
                                : "badge-priority-green"
                      }`}>
                        {exam.status === "realizado" ? "Realizado" : exam.deadlineStatusLabel || "Planejado"}
                      </span>
                      <span className={`badge badge-soft ${exam.required ? "badge-priority-red" : "badge-priority-blue"}`}>
                        {exam.required ? "Obrigatorio" : "Recomendado"}
                      </span>
                      {exam.shouldHaveBeenDone ? (
                        <span className="badge badge-priority-red">Janela ideal passou</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="timeline-meta">
                    <span><strong>Data prevista:</strong> {exam.predictedDateLabel}</span>
                    <span><strong>Agendado para:</strong> {exam.scheduledDateLabel || "Ainda nao agendado"}</span>
                    <span><strong>Horario:</strong> {exam.scheduledTime || "Nao informado"}</span>
                    <span><strong>Realizado em:</strong> {exam.completedDateLabel || "Ainda nao realizado"}</span>
                  </div>
                  {exam.shouldHaveBeenDone ? (
                    <p className="timeline-warning">Este exame ja passou da janela ideal e precisa de atencao da equipe.</p>
                  ) : null}
                  {exam.schedulingNotes ? <p className="timeline-notes">{exam.schedulingNotes}</p> : null}
                </div>
              </div>
            )) : <p className="empty-state">Nenhum exame encontrado para montar a linha do tempo.</p>}
          </div>
        </article>

          </div>
        ) : null}

        {activeTab === "exames" ? (
          <div className="detail-layout detail-layout-single">
        <article className="panel-card" id="exames-paciente">
          <p className="muted-label">Proximos exames</p>
          <div className="message-history-list">
            {upcomingExams.length ? upcomingExams.map((exam) => (
              <div
                key={exam.id}
                className={`message-history-item exam-detail-card ${
                  confirmingScheduledExamId === exam.id || confirmingRealizedExamId === exam.id
                    ? "exam-detail-card-pending-confirmation"
                    : ""
                }`}
              >
                <div className="card-row">
                  <span className="exam-name-strong"><strong>{exam.name}</strong></span>
                  <div className="priority-badge-row">
                    {exam.deadlineStatusLabel ? (
                      <span className={`badge ${
                        exam.deadlineStatus === "atrasado"
                          ? "badge-priority-red"
                          : exam.deadlineStatus === "pendente"
                            ? "badge-priority-orange"
                            : exam.deadlineStatus === "aproximando"
                              ? "badge-priority-yellow"
                              : "badge-priority-green"
                      }`}>
                        {exam.deadlineStatusLabel}
                      </span>
                    ) : null}
                    <span className={`badge badge-soft ${exam.required ? "badge-priority-red" : "badge-priority-blue"}`}>
                      {exam.required ? "Obrigatorio" : "Recomendado"}
                    </span>
                  </div>
                </div>
                <span><strong>Previsao:</strong> {exam.predictedDateLabel}</span>
                <span><strong>Status:</strong> {exam.status}</span>
                <span><strong>Lembrete 1:</strong> {exam.reminderDate1 || "Nao definido"}</span>
                <span><strong>Lembrete 2:</strong> {exam.reminderDate2 || "Nao definido"}</span>
                <div className="two-columns">
                  <label>
                    Data do agendamento
                    <input
                      type="date"
                      className={invalidScheduleFields[exam.id]?.scheduledDate ? "field-input-error" : ""}
                      value={scheduledDates[exam.id] || ""}
                      onChange={(event) => {
                        setScheduledDates((current) => ({ ...current, [exam.id]: event.target.value }));
                        setInvalidScheduleFields((current) => ({
                          ...current,
                          [exam.id]: {
                            scheduledDate: false,
                            scheduledTime: current[exam.id]?.scheduledTime ?? false
                          }
                        }));
                      }}
                    />
                  </label>
                  <label>
                    Horario do exame
                    <input
                      type="time"
                      className={invalidScheduleFields[exam.id]?.scheduledTime ? "field-input-error" : ""}
                      value={scheduledTimes[exam.id] || ""}
                      onChange={(event) => {
                        setScheduledTimes((current) => ({ ...current, [exam.id]: event.target.value }));
                        setInvalidScheduleFields((current) => ({
                          ...current,
                          [exam.id]: {
                            scheduledDate: current[exam.id]?.scheduledDate ?? false,
                            scheduledTime: false
                          }
                        }));
                      }}
                    />
                  </label>
                </div>
                <label>
                  Observacoes do agendamento
                  <textarea
                    rows={3}
                    value={schedulingNotes[exam.id] || ""}
                    onChange={(event) =>
                      setSchedulingNotes((current) => ({ ...current, [exam.id]: event.target.value }))
                    }
                    placeholder="Ex.: paciente prefere periodo da tarde, levar pedido medico, retorno em unidade X."
                  />
                </label>
                <div className="two-columns">
                  <label>
                    Data real de realizacao
                    <input
                      type="date"
                      className={invalidCompletedDateExamId === exam.id ? "field-input-error" : ""}
                      value={completedDates[exam.id] || ""}
                      onChange={(event) => {
                        setCompletedDates((current) => ({ ...current, [exam.id]: event.target.value }));
                        if (invalidCompletedDateExamId === exam.id) {
                          setInvalidCompletedDateExamId(null);
                        }
                      }}
                    />
                  </label>
                </div>
                <span><strong>Agendamento salvo:</strong> {exam.scheduledDateLabel || "Nao informado"}</span>
                <span><strong>Horario salvo:</strong> {exam.scheduledTime || "Nao informado"}</span>
                <span><strong>Agendado por:</strong> {exam.scheduledByName || "Nao registrado"}</span>
                <span><strong>Observacoes:</strong> {exam.schedulingNotes || "Sem observacoes"}</span>
                <span><strong>Realizacao salva:</strong> {exam.completedDateLabel || "Nao informada"}</span>
                <span><strong>Realizado por:</strong> {exam.completedByName || "Nao registrado"}</span>
                {exam.shouldHaveBeenDone ? <span className="exam-warning-text">Ja deveria ter sido realizado.</span> : null}
                <div className="inline-actions list-action-bar exam-action-bar">
                  {confirmingScheduledExamId === exam.id ? (
                    <>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={savingExamId === exam.id || exam.status === "agendado"}
                        onClick={async () => {
                          try {
                            await handleExamStatusUpdate(exam.id, "agendado");
                          } finally {
                            setConfirmingScheduledExamId(null);
                          }
                        }}
                      >
                        {savingExamId === exam.id ? "Salvando..." : "Confirmar agendamento"}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={savingExamId === exam.id}
                        onClick={() => setConfirmingScheduledExamId(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={savingExamId === exam.id || exam.status === "agendado"}
                      onClick={() => setConfirmingScheduledExamId(exam.id)}
                    >
                      Marcar agendado
                    </button>
                  )}
                  {confirmingRealizedExamId === exam.id ? (
                    <>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={savingExamId === exam.id || exam.status === "realizado"}
                        onClick={async () => {
                          try {
                            await handleExamStatusUpdate(exam.id, "realizado");
                          } finally {
                            setConfirmingRealizedExamId(null);
                          }
                        }}
                      >
                        {savingExamId === exam.id ? "Salvando..." : "Confirmar realizado"}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={savingExamId === exam.id}
                        onClick={() => setConfirmingRealizedExamId(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={savingExamId === exam.id || exam.status === "realizado"}
                      onClick={() => setConfirmingRealizedExamId(exam.id)}
                    >
                      Marcar realizado
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingExamId === exam.id || exam.status === "pendente"}
                    onClick={() => handleExamStatusUpdate(exam.id, "pendente")}
                  >
                    {savingExamId === exam.id ? "Salvando..." : "Voltar para pendente"}
                  </button>
                </div>
              </div>
            )) : <p className="empty-state">Nenhum proximo exame pendente.</p>}
          </div>
        </article>

        <article className="panel-card">
          <p className="muted-label">Exames ja realizados</p>
          <div className="message-history-list">
            {completedExams.length ? completedExams.map((exam) => (
                  <div key={exam.id} className="message-history-item exam-detail-card exam-detail-card-completed">
                  <div className="card-row">
                      <span className="exam-name-strong"><strong>{exam.name}</strong></span>
                      <div className="priority-badge-row">
                    <span className="badge badge-priority-green">Realizado</span>
                    <span className={`badge badge-soft ${exam.required ? "badge-priority-red" : "badge-priority-blue"}`}>
                      {exam.required ? "Obrigatorio" : "Recomendado"}
                    </span>
                  </div>
                </div>
                <span><strong>Previsao:</strong> {exam.predictedDateLabel}</span>
                <span><strong>Agendamento salvo:</strong> {exam.scheduledDateLabel || "Nao informado"}</span>
                <span><strong>Horario salvo:</strong> {exam.scheduledTime || "Nao informado"}</span>
                <span><strong>Agendado por:</strong> {exam.scheduledByName || "Nao registrado"}</span>
                <span><strong>Observacoes:</strong> {exam.schedulingNotes || "Sem observacoes"}</span>
                <span><strong>Realizacao salva:</strong> {exam.completedDateLabel || "Nao informada"}</span>
                <span><strong>Realizado por:</strong> {exam.completedByName || "Nao registrado"}</span>
              </div>
            )) : <p className="empty-state">Nenhum exame realizado ainda.</p>}
          </div>
        </article>

          </div>
        ) : null}

        {activeTab === "historico" ? (
          <div className="detail-layout detail-layout-single">
        <article className="panel-card">
          <p className="muted-label">Historico de contatos</p>
          <div className="message-history-list">
            {details.messages.length ? details.messages.map((message) => (
              <div key={message.id} className="message-history-item">
                <span><strong>Envio:</strong> {message.deliveryStatus}</span>
                <span><strong>Resposta:</strong> {message.responseStatus}</span>
                <span><strong>Data:</strong> {message.sentAt || "Nao registrada"}</span>
                <p>{message.content}</p>
              </div>
            )) : <p className="empty-state">Nenhuma mensagem registrada.</p>}
          </div>
        </article>

        <article className="panel-card">
          <p className="muted-label">Historico de movimentacoes no kanban</p>
          <div className="message-history-list">
            {details.movements.length ? details.movements.map((movement) => (
              <div key={movement.id} className="message-history-item">
                <span><strong>Acao:</strong> {movement.actionType}</span>
                <span><strong>De:</strong> {movement.fromStage || "Sem coluna anterior"}</span>
                <span><strong>Para:</strong> {movement.toStage || "Sem coluna de destino"}</span>
                <span><strong>Data:</strong> {movement.createdAt}</span>
                <p>{movement.description}</p>
              </div>
            )) : <p className="empty-state">Nenhum historico registrado.</p>}
          </div>
        </article>

          </div>
        ) : null}
      </div>
    </section>
  );
}
