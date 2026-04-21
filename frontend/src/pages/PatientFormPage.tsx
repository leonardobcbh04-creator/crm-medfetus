import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import type { ClinicPhysician, ClinicUnit, ExamConfig, ExamProtocolPreset, PatientDetails } from "../types";
import { formatBrazilPhone } from "../utils/phone";

type PatientFormState = {
  name: string;
  phone: string;
  clinicPatientId: string;
  birthDate: string;
  gestationalWeeks: string;
  gestationalDays: string;
  lastCompletedExamCode: string;
  physicianName: string;
  clinicUnit: string;
  pregnancyType: string;
  highRisk: boolean;
  notes: string;
};

const EMPTY_FORM: PatientFormState = {
  name: "",
  phone: "",
  clinicPatientId: "",
  birthDate: "",
  gestationalWeeks: "",
  gestationalDays: "0",
  lastCompletedExamCode: "",
  physicianName: "",
  clinicUnit: "",
  pregnancyType: "Unica",
  highRisk: false,
  notes: ""
};

const PREGNANCY_TYPE_OPTIONS = [
  {
    value: "Unica",
    label: "Unica",
    description: "Gestacao com um bebe."
  },
  {
    value: "Gemelar",
    label: "Gemelar",
    description: "Gestacao com dois bebes."
  },
  {
    value: "Multipla",
    label: "Multipla",
    description: "Gestacao com tres ou mais bebes."
  }
];

const HIGH_RISK_HELP = {
  active: "Use quando a paciente exigir acompanhamento mais atento, com protocolo e lembretes reforcados.",
  inactive: "Deixe desmarcado quando o acompanhamento seguir a rotina habitual da clinica."
};

function maskPhone(value: string) {
  return formatBrazilPhone(value);
}

function addDays(baseDate: string, days: number) {
  const date = new Date(`${baseDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(date: string | null) {
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getGestationalReferenceDays(gestationalWeeks: string, gestationalDays: string) {
  const weeks = Number(gestationalWeeks);
  const days = Number(gestationalDays);

  if (!Number.isInteger(weeks) || weeks < 0 || !Number.isInteger(days) || days < 0 || days > 6) {
    return null;
  }

  return weeks * 7 + days;
}

function getBaseDateFromGestationalAge(gestationalWeeks: string, gestationalDays: string) {
  const totalDays = getGestationalReferenceDays(gestationalWeeks, gestationalDays);
  if (totalDays == null) {
    return "";
  }

  return addDays(getTodayIso(), totalDays * -1);
}

function getGestationalAgeLabel(gestationalWeeks: string, gestationalDays: string) {
  const totalDays = getGestationalReferenceDays(gestationalWeeks, gestationalDays);
  if (totalDays == null) {
    return "Preencha a idade gestacional em semanas e dias.";
  }

  return `${Math.floor(totalDays / 7)} semanas e ${totalDays % 7} dias`;
}

function formatGestationalWeekValue(value: number) {
  const weeks = Math.floor(value);
  const days = Math.round((value - weeks) * 7);
  if (!days) {
    return `${weeks}`;
  }
  return `${weeks}s${days}d`;
}

function formatGestationalWeekRange(startWeek: number, endWeek: number) {
  return `${formatGestationalWeekValue(startWeek)} a ${formatGestationalWeekValue(endWeek)}`;
}

function getExamPreview(gestationalWeeks: string, gestationalDays: string, examConfigs: ExamConfig[]) {
  const baseDate = getBaseDateFromGestationalAge(gestationalWeeks, gestationalDays);
  if (!baseDate) {
    return [];
  }

  return examConfigs
    .filter((exam) => exam.active && exam.flowType === "automatico")
    .map((exam) => ({
      id: exam.id,
      name: exam.name,
      predictedDate: addDays(baseDate, exam.targetWeek * 7),
      startWeek: exam.startWeek,
      endWeek: exam.endWeek
    }));
}

export function PatientFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [formData, setFormData] = useState<PatientFormState>(EMPTY_FORM);
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([]);
  const [presets, setPresets] = useState<ExamProtocolPreset[]>([]);
  const [units, setUnits] = useState<ClinicUnit[]>([]);
  const [physicians, setPhysicians] = useState<ClinicPhysician[]>([]);
  const [patientDetails, setPatientDetails] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadPage() {
      try {
        const [examConfigResponse, catalogResponse, detailsResponse] = await Promise.all([
          api.getExamConfigs(),
          api.getPatientFormCatalogs(),
          isEditing && id ? api.getPatientDetails(Number(id)) : Promise.resolve(null)
        ]);

        if (!isMounted) {
          return;
        }

        setExamConfigs(examConfigResponse.examConfigs);
        setPresets(examConfigResponse.presets);
        setUnits(catalogResponse.units);
        setPhysicians(catalogResponse.physicians);

        if (detailsResponse) {
          setPatientDetails(detailsResponse);
          setFormData({
            name: detailsResponse.patient.name,
            phone: detailsResponse.patient.phone,
            clinicPatientId: detailsResponse.patient.clinicPatientId || "",
            birthDate: detailsResponse.patient.birthDate || "",
            gestationalWeeks: detailsResponse.patient.gestationalWeeks != null ? String(detailsResponse.patient.gestationalWeeks) : "",
            gestationalDays: detailsResponse.patient.gestationalDays != null ? String(detailsResponse.patient.gestationalDays) : "0",
            lastCompletedExamCode: "",
            physicianName: detailsResponse.patient.physicianName || "",
            clinicUnit: detailsResponse.patient.clinicUnit || "",
            pregnancyType: detailsResponse.patient.pregnancyType || "Unica",
            highRisk: Boolean(detailsResponse.patient.highRisk),
            notes: detailsResponse.patient.notes || ""
          });
        }
      } catch (error) {
        if (isMounted) {
          setMessageType("error");
            setMessage(error instanceof Error ? error.message : "Nao foi possivel carregar os dados do formulario.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      isMounted = false;
    };
  }, [id, isEditing]);

  const baseDate = useMemo(
    () => getBaseDateFromGestationalAge(formData.gestationalWeeks, formData.gestationalDays),
    [formData.gestationalWeeks, formData.gestationalDays]
  );
  const dpp = useMemo(() => (baseDate ? addDays(baseDate, 280) : ""), [baseDate]);
  const gestationalAgeLabel = useMemo(
    () => getGestationalAgeLabel(formData.gestationalWeeks, formData.gestationalDays),
    [formData.gestationalWeeks, formData.gestationalDays]
  );
  const availableUnits = useMemo(() => {
    if (formData.clinicUnit && !units.some((unit) => unit.name === formData.clinicUnit)) {
      return [...units, { id: -1, name: formData.clinicUnit, active: true }];
    }
    return units;
  }, [formData.clinicUnit, units]);
  const availablePhysicians = useMemo(() => {
    const matchingPhysicians = physicians.filter((physician) => {
      if (!formData.clinicUnit) {
        return true;
      }
      return physician.clinicUnitName === formData.clinicUnit;
    });

    if (formData.physicianName && !matchingPhysicians.some((physician) => physician.name === formData.physicianName)) {
      return [
        ...matchingPhysicians,
        {
          id: -1,
          name: formData.physicianName,
          clinicUnitId: null,
          clinicUnitName: formData.clinicUnit || null,
          active: true
        }
      ];
    }

    return matchingPhysicians;
  }, [formData.clinicUnit, formData.physicianName, physicians]);
  const examPreview = useMemo(
    () => getExamPreview(formData.gestationalWeeks, formData.gestationalDays, examConfigs),
    [formData.gestationalWeeks, formData.gestationalDays, examConfigs]
  );
  const automaticExamOptions = useMemo(
    () => examConfigs.filter((exam) => exam.active && exam.flowType === "automatico").sort((left, right) => left.sortOrder - right.sortOrder),
    [examConfigs]
  );
  const nextExam = useMemo(() => {
    const today = getTodayIso();
    return examPreview.find((exam) => exam.predictedDate >= today) || examPreview[0] || null;
  }, [examPreview]);
  const recommendedPresetId = useMemo(() => {
    const multiplePregnancy = formData.pregnancyType === "Gemelar" || formData.pregnancyType === "Multipla";

    if (multiplePregnancy && formData.highRisk) {
      return "gemelar_alto_risco";
    }
    if (multiplePregnancy) {
      return "gemelar";
    }
    if (formData.highRisk) {
      return "alto_risco";
    }
    return "unica_padrao";
  }, [formData.highRisk, formData.pregnancyType]);
  const recommendedPreset = useMemo(
    () => presets.find((preset) => preset.id === recommendedPresetId) || null,
    [presets, recommendedPresetId]
  );

  function updateField<K extends keyof PatientFormState>(field: K, value: PatientFormState[K]) {
    setFormData((current) => ({ ...current, [field]: value }));
  }

  function handleClinicUnitChange(nextUnit: string) {
    setFormData((current) => {
      const physicianStillValid = physicians.some((physician) =>
        physician.name === current.physicianName && physician.clinicUnitName === nextUnit
      );

      return {
        ...current,
        clinicUnit: nextUnit,
        physicianName: nextUnit && physicianStillValid ? current.physicianName : ""
      };
    });
  }

  function handlePhysicianChange(nextPhysician: string) {
    const selectedPhysician = physicians.find((physician) => physician.name === nextPhysician);

    setFormData((current) => ({
      ...current,
      physicianName: nextPhysician,
      clinicUnit: selectedPhysician?.clinicUnitName || current.clinicUnit
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formData.name.trim() || !formData.phone.trim() || !formData.birthDate || !formData.gestationalWeeks.trim()) {
      setMessageType("error");
        setMessage("Preencha os campos obrigatorios para continuar.");
      return;
    }

    if (Number(formData.gestationalDays) < 0 || Number(formData.gestationalDays) > 6) {
      setMessageType("error");
      setMessage("Informe os dias da idade gestacional entre 0 e 6.");
      return;
    }

    if (!formData.physicianName.trim() || !formData.clinicUnit.trim() || !formData.pregnancyType.trim()) {
      setMessageType("error");
        setMessage("Medico, unidade e tipo de gestacao sao obrigatorios.");
      return;
    }

    if (!formData.notes.trim()) {
      setMessageType("error");
        setMessage("Preencha as observacoes para concluir o cadastro.");
      return;
    }

    setMessage("");
    setIsSaving(true);

    try {
      const payload = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        clinicPatientId: formData.clinicPatientId.trim() || null,
        birthDate: formData.birthDate,
        gestationalWeeks: Number(formData.gestationalWeeks),
        gestationalDays: Number(formData.gestationalDays || "0"),
        lastCompletedExamCode: !isEditing && formData.lastCompletedExamCode ? formData.lastCompletedExamCode : undefined,
        dpp,
        physicianName: formData.physicianName.trim(),
        clinicUnit: formData.clinicUnit.trim(),
        pregnancyType: formData.pregnancyType,
        highRisk: formData.highRisk,
        notes: formData.notes.trim(),
        status: patientDetails?.patient.status || "ativa"
      };

      const response = isEditing && id
        ? await api.updatePatient(Number(id), payload)
        : await api.createPatient(payload);

      setMessageType("success");
      setMessage(isEditing ? "Paciente atualizada com sucesso." : "Paciente cadastrada com sucesso.");
      navigate(`/pacientes/${response.patient.patient.id}`);
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Nao foi possivel salvar os dados da paciente.");
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
      return <p className="loading-text">Carregando dados da paciente...</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">{isEditing ? "Edicao" : "Cadastro"}</p>
          <h2>{isEditing ? "Editar paciente" : "Nova paciente"}</h2>
          <p className="page-description">
              Preencha os dados principais para organizar o acompanhamento e calcular a previsao inicial dos exames.
          </p>
        </div>
        {isEditing && id ? (
          <Link to={`/pacientes/${id}`} className="secondary-button">Voltar aos detalhes</Link>
        ) : (
          <Link to="/kanban" className="secondary-button">Voltar ao kanban</Link>
        )}
      </div>

      <div className="detail-layout patient-form-layout">
        <form className="panel-card stack-form" onSubmit={handleSubmit}>
          <div className="form-section-header">
            <p className="muted-label">Dados principais</p>
            <p className="field-hint">Campos essenciais para a recepcao iniciar o acompanhamento.</p>
          </div>

          <label>
            Nome completo
            <input
              value={formData.name}
              onChange={(event) => updateField("name", event.target.value)}
              type="text"
              placeholder="Ex.: Maria Aparecida da Silva"
              required
            />
          </label>

          <div className="two-columns">
            <label>
              Telefone com WhatsApp
              <input
                value={maskPhone(formData.phone)}
                onChange={(event) => updateField("phone", event.target.value.replace(/\D/g, ""))}
                type="tel"
                placeholder="(31) 99999-9999"
                required
              />
              <span className="field-hint">Voce pode digitar so os numeros. O formato aparece automaticamente.</span>
            </label>

            <label>
              ID da clinica
              <input
                value={formData.clinicPatientId}
                onChange={(event) => updateField("clinicPatientId", event.target.value)}
                type="text"
                placeholder="Ex.: MF-2048"
              />
              <span className="field-hint">Use quando a clinica trabalhar com um identificador interno da paciente.</span>
            </label>
          </div>

          <div className="two-columns">
            <label>
              Data de nascimento
              <input
                value={formData.birthDate}
                onChange={(event) => updateField("birthDate", event.target.value)}
                type="date"
                required
              />
            </label>
          </div>

          <div className="two-columns">
            <label>
              Idade gestacional em semanas
              <input
                value={formData.gestationalWeeks}
                onChange={(event) => updateField("gestationalWeeks", event.target.value.replace(/\D/g, ""))}
                type="text"
                inputMode="numeric"
                placeholder="Ex.: 12"
                required
              />
              <span className="field-hint">Use a idade gestacional informada pelo medico apos o primeiro exame.</span>
            </label>

            <label>
              Idade gestacional em dias
              <input
                value={formData.gestationalDays}
                onChange={(event) => updateField("gestationalDays", event.target.value.replace(/\D/g, ""))}
                type="text"
                inputMode="numeric"
                placeholder="0 a 6"
                required
              />
              <span className="field-hint">Informe de 0 a 6 dias alem das semanas completas.</span>
            </label>
          </div>

          {!isEditing ? (
            <label>
              Ultimo exame realizado
              <select
                value={formData.lastCompletedExamCode}
                onChange={(event) => updateField("lastCompletedExamCode", event.target.value)}
              >
                <option value="">Paciente iniciando no comeco do acompanhamento</option>
                {automaticExamOptions.map((exam) => (
                  <option key={exam.id} value={exam.code}>
                    {exam.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                  Use quando a paciente ja chegar no meio do acompanhamento. O exame escolhido e os anteriores ficam registrados como historico previo, sem data.
                </span>
            </label>
          ) : null}

          <div className="two-columns">
            <label>
              DPP calculada automaticamente
              <input value={dpp ? formatDate(dpp) : ""} type="text" placeholder="Preenchida automaticamente" readOnly />
            </label>
            <label>
              Data base estimada internamente
              <input value={baseDate ? formatDate(baseDate) : ""} type="text" placeholder="Calculada automaticamente" readOnly />
            </label>
          </div>

          <div className="two-columns">
            <label>
              Medico solicitante
              <select
                value={formData.physicianName}
                onChange={(event) => handlePhysicianChange(event.target.value)}
                required
              >
                <option value="">Selecione um medico</option>
                {availablePhysicians.map((physician) => (
                  <option key={`${physician.id}-${physician.name}`} value={physician.name}>
                    {physician.name}
                    {physician.clinicUnitName ? ` - ${physician.clinicUnitName}` : ""}
                  </option>
                ))}
              </select>
              <span className="field-hint">A lista vem da area administrativa.</span>
            </label>

            <label>
              Unidade
              <select
                value={formData.clinicUnit}
                onChange={(event) => handleClinicUnitChange(event.target.value)}
                required
              >
                <option value="">Selecione uma unidade</option>
                {availableUnits.map((unit) => (
                  <option key={`${unit.id}-${unit.name}`} value={unit.name}>
                    {unit.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">Ao trocar a unidade, a lista de medicos e filtrada automaticamente.</span>
            </label>
          </div>

          <div className="form-section-header">
            <p className="muted-label">Perfil obstetrico</p>
            <p className="field-hint">Esses dados ajudam a equipe a adaptar o protocolo e a prioridade do acompanhamento.</p>
          </div>

          <div className="two-columns">
            <label>
              Tipo de gestacao
              <select
                value={formData.pregnancyType}
                onChange={(event) => updateField("pregnancyType", event.target.value)}
                required
              >
                {PREGNANCY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {PREGNANCY_TYPE_OPTIONS.find((option) => option.value === formData.pregnancyType)?.description}
              </span>
            </label>

            <label className="checkbox-field">
              Alto risco
              <div className={`checkbox-row patient-checkbox ${formData.highRisk ? "patient-checkbox-active" : ""}`}>
                <input
                  checked={formData.highRisk}
                  onChange={(event) => updateField("highRisk", event.target.checked)}
                  type="checkbox"
                />
                <div className="risk-guidance">
                    <strong>{formData.highRisk ? "Paciente marcada como alto risco." : "Acompanhamento habitual."}</strong>
                  <span>{formData.highRisk ? HIGH_RISK_HELP.active : HIGH_RISK_HELP.inactive}</span>
                </div>
              </div>
            </label>
          </div>

          <div className="form-section-header">
            <p className="muted-label">Observacoes de atendimento</p>
            <p className="field-hint">Use este campo para preferencia de contato, combinados e observacoes clinicas relevantes.</p>
          </div>

          <label>
            Observacoes
            <textarea
              value={formData.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={5}
              placeholder="Ex.: prefere contato por WhatsApp, periodo melhor para atendimento, observacoes clinicas."
              required
            />
          </label>

          {message ? (
            <div className={messageType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
                <strong>{messageType === "error" ? "Atencao" : "Tudo certo"}</strong>
              <span>{message}</span>
            </div>
          ) : null}

          <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? "Salvando..." : isEditing ? "Salvar alteracoes" : "Cadastrar paciente"}
          </button>
        </form>

        <div className="stack-form">
          <article className="panel-card info-strip">
            <div className="summary-chip">
              <span className="chip-label">Recepcao</span>
              <strong>Fluxo guiado</strong>
            </div>
            <div className="summary-chip">
              <span className="chip-label">WhatsApp</span>
              <strong>{formData.phone ? maskPhone(formData.phone) : "Ainda nao preenchido"}</strong>
            </div>
            <div className="summary-chip">
              <span className="chip-label">Risco</span>
              <strong>{formData.highRisk ? "Alto risco" : "Habitual"}</strong>
            </div>
          </article>

          <article className="panel-card">
            <p className="muted-label">Resumo automatico</p>
            <div className="message-metadata">
              <span><strong>Idade gestacional atual:</strong> {gestationalAgeLabel}</span>
              <span><strong>DPP:</strong> {dpp ? formatDate(dpp) : "Preencha a idade gestacional"}</span>
              <span><strong>Proximo exame esperado:</strong> {nextExam ? nextExam.name : "Sera definido apos informar a idade gestacional"}</span>
              <span><strong>Data ideal:</strong> {nextExam ? formatDate(nextExam.predictedDate) : "-"}</span>
              <span className="field-hint">Esses calculos sao automaticos e podem ser ajustados depois nas configuracoes de exames.</span>
            </div>
          </article>

          <article className="panel-card recommended-preset-card">
            <p className="muted-label">Protocolo sugerido</p>
            <h3>{recommendedPreset?.name || "Carregando sugestao"}</h3>
            <p className="page-description">
              {recommendedPreset?.description || "O sistema avalia tipo de gestacao e alto risco para orientar o protocolo clinico."}
            </p>
            <span className="field-hint">
              Sugestao automatica com base no perfil atual da paciente. A configuracao global continua editavel pelo administrador.
            </span>
            <Link to={`/exames?preset=${recommendedPresetId}`} className="secondary-button">
              Ver protocolo recomendado
            </Link>
          </article>

          <article className="panel-card">
            <p className="muted-label">Previsao inicial dos exames</p>
            <div className="message-history-list">
              {examPreview.length ? examPreview.map((exam) => (
                <div key={exam.id} className="message-history-item">
                  <span><strong>{exam.name}</strong></span>
                  <span><strong>Janela recomendada:</strong> {formatGestationalWeekRange(exam.startWeek, exam.endWeek)} semanas</span>
                  <span><strong>Data prevista:</strong> {formatDate(exam.predictedDate)}</span>
                </div>
              )) : <p className="empty-state">Informe a idade gestacional para visualizar a previsao dos exames futuros.</p>}
            </div>
          </article>

          <article className="panel-card">
            <p className="muted-label">Historico da paciente</p>
            <div className="message-history-list">
              {patientDetails?.movements.length ? patientDetails.movements.map((movement) => (
                <div key={movement.id} className="message-history-item">
                  <span><strong>Acao:</strong> {movement.actionType}</span>
                  <span><strong>Data:</strong> {movement.createdAt}</span>
                  <p>{movement.description}</p>
                </div>
              )) : <p className="empty-state">O historico aparecera aqui depois do primeiro salvamento.</p>}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
