import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import type { ExamConfig, ExamProtocolPreset } from "../types";

export function ExamSettingsPage() {
  const [searchParams] = useSearchParams();
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([]);
  const [presets, setPresets] = useState<ExamProtocolPreset[]>([]);
  const [message, setMessage] = useState("");
  const [isApplyingPreset, setIsApplyingPreset] = useState<string | null>(null);
  const suggestedPresetId = searchParams.get("preset");

  useEffect(() => {
    api.getExamConfigs().then((response) => {
      setExamConfigs(response.examConfigs);
      setPresets(response.presets);
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>, examConfig: ExamConfig) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const payload = {
      name: String(formData.get("name") || examConfig.name),
      startWeek: Number(formData.get("startWeek") || examConfig.startWeek),
      endWeek: Number(formData.get("endWeek") || examConfig.endWeek),
      targetWeek: Number(formData.get("targetWeek") || examConfig.targetWeek),
      reminderDaysBefore1: Number(formData.get("reminderDaysBefore1") || examConfig.reminderDaysBefore1),
      reminderDaysBefore2: Number(formData.get("reminderDaysBefore2") || examConfig.reminderDaysBefore2),
      defaultMessage: String(formData.get("defaultMessage") || examConfig.defaultMessage),
      required: formData.get("required") === "on",
      flowType: String(formData.get("flowType") || examConfig.flowType),
      active: formData.get("active") === "on"
    };

    const response = await api.updateExamConfig(examConfig.id, payload);
    setExamConfigs((current) =>
      current.map((item) => (item.id === examConfig.id ? response.examConfig : item))
    );
    setMessage("Protocolos atualizados com sucesso.");
  }

  async function handleApplyPreset(preset: ExamProtocolPreset) {
    setMessage("");
    setIsApplyingPreset(preset.id);

    try {
      const response = await api.applyExamPreset(preset.id);
      setExamConfigs(response.examConfigs);
      setMessage(`Protocolo "${preset.name}" aplicado. Voce ainda pode ajustar qualquer exame abaixo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel aplicar o protocolo sugerido.");
    } finally {
      setIsApplyingPreset(null);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Protocolos</p>
          <h2>Configuracao de exames</h2>
          <p className="page-description">
            Estes parametros sao uma configuracao inicial da clinica e podem ser ajustados pelo administrador a qualquer momento.
          </p>
        </div>
      </div>

      {message ? <p className={message.includes("sucesso") || message.includes("aplicado") ? "form-success" : "form-error"}>{message}</p> : null}

      <section className="preset-grid">
        {presets.map((preset) => (
          <article
            key={preset.id}
            className={`panel-card preset-card ${suggestedPresetId === preset.id ? "preset-card-highlight" : ""}`}
          >
            <p className="muted-label">Atalho de protocolo</p>
            <h3>{preset.name}</h3>
            <p className="page-description">{preset.description}</p>
            {suggestedPresetId === preset.id ? (
              <span className="field-hint">Sugerido pelo cadastro da paciente atual.</span>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => handleApplyPreset(preset)}
              disabled={Boolean(isApplyingPreset)}
            >
              {isApplyingPreset === preset.id ? "Aplicando..." : "Aplicar protocolo"}
            </button>
          </article>
        ))}
      </section>

      <div className="settings-grid">
        {examConfigs.map((examConfig) => (
          <form key={examConfig.id} className="panel-card stack-form" onSubmit={(event) => handleSubmit(event, examConfig)}>
            <label>
              Nome do exame
              <input name="name" defaultValue={examConfig.name} />
            </label>

            <div className="three-columns">
              <label>
                Semana inicial
                <input name="startWeek" type="number" defaultValue={examConfig.startWeek} />
              </label>

              <label>
                Semana final
                <input name="endWeek" type="number" defaultValue={examConfig.endWeek} />
              </label>

              <label>
                Semana alvo
                <input name="targetWeek" type="number" defaultValue={examConfig.targetWeek} />
              </label>
            </div>

            <div className="two-columns">
              <label>
                Lembrete 1 (dias antes)
                <input name="reminderDaysBefore1" type="number" min="0" defaultValue={examConfig.reminderDaysBefore1} />
              </label>

              <label>
                Lembrete 2 (dias antes)
                <input name="reminderDaysBefore2" type="number" min="0" defaultValue={examConfig.reminderDaysBefore2} />
              </label>
            </div>

            <div className="two-columns">
              <label className="checkbox-row">
                <input name="required" type="checkbox" defaultChecked={examConfig.required} />
                Exame obrigatorio
              </label>

              <label>
                Tipo de fluxo
                <select name="flowType" defaultValue={examConfig.flowType}>
                  <option value="automatico">Automatico</option>
                  <option value="avulso">Avulso/manual</option>
                </select>
              </label>
            </div>

            <label>
              Mensagem padrao de WhatsApp
              <textarea name="defaultMessage" rows={4} defaultValue={examConfig.defaultMessage} />
            </label>

            <p className="field-hint">
              Obrigatorio = exame clinico essencial. Avulso/manual = exame recomendado, mas fora do fluxo automatico do CRM.
            </p>

            <label className="checkbox-row">
              <input name="active" type="checkbox" defaultChecked={examConfig.active} />
              Exame ativo
            </label>

            <button className="secondary-button" type="submit">
              Salvar alteracao
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
