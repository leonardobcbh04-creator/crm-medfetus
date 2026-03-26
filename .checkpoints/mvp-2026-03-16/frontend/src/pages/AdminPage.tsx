import { FormEvent, useEffect, useState } from "react";
import { api } from "../services/api";
import type { AdminPanelData, AppUser, ClinicPhysician, ClinicUnit, ExamConfig, MessageTemplate } from "../types";

type AdminTab = "usuarios" | "cadastros" | "exames" | "mensageria";

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="form-section-header">
      <p className="muted-label">{eyebrow}</p>
      <h3>{title}</h3>
      <p className="field-hint">{description}</p>
    </div>
  );
}

function QuickActionCard({
  icon,
  title,
  description,
  actionLabel,
  onAction
}: {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <article className="admin-quick-card">
      <div className="admin-quick-icon" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      <p>{description}</p>
      <button type="button" className="secondary-button" onClick={onAction}>
        {actionLabel}
      </button>
    </article>
  );
}

export function AdminPage() {
  const [adminData, setAdminData] = useState<AdminPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("usuarios");
  const [savingKey, setSavingKey] = useState("");
  const [searchUsers, setSearchUsers] = useState("");
  const [searchUnits, setSearchUnits] = useState("");
  const [searchPhysicians, setSearchPhysicians] = useState("");
  const [searchExams, setSearchExams] = useState("");

  useEffect(() => {
    loadAdminData();
  }, []);

  async function loadAdminData() {
    setLoading(true);
    try {
      const response = await api.getAdminPanel();
      setAdminData(response);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a area administrativa.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-user");
    setFeedback("");

    try {
      const response = await api.createAdminUser({
        name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || "atendente"),
        active: formData.get("active") === "on"
      });
      setAdminData((current) => current ? { ...current, users: [...current.users, response.user] } : current);
      form.reset();
      setFeedback("Usuario criado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>, user: AppUser) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`user-${user.id}`);
    setFeedback("");

    try {
      const response = await api.updateAdminUser(user.id, {
        name: String(formData.get("name") || user.name),
        email: String(formData.get("email") || user.email),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || user.role),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, users: current.users.map((item) => (item.id === user.id ? response.user : item)) }
          : current
      );
      setFeedback("Usuario atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeleteUser(user: AppUser) {
    const confirmed = window.confirm(`Deseja excluir o usuario ${user.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-user-${user.id}`);
    setFeedback("");
    try {
      await api.deleteAdminUser(user.id);
      setAdminData((current) =>
        current ? { ...current, users: current.users.filter((item) => item.id !== user.id) } : current
      );
      setFeedback("Usuario excluido da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreateUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-unit");
    setFeedback("");

    try {
      const response = await api.createClinicUnit({
        name: String(formData.get("name") || ""),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current ? { ...current, units: [...current.units, response.unit].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) } : current
      );
      form.reset();
      setFeedback("Unidade criada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateUnit(event: FormEvent<HTMLFormElement>, unit: ClinicUnit) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`unit-${unit.id}`);
    setFeedback("");

    try {
      const response = await api.updateClinicUnit(unit.id, {
        name: String(formData.get("name") || unit.name),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? {
              ...current,
              units: current.units.map((item) => (item.id === unit.id ? response.unit : item)),
              physicians: current.physicians.map((item) =>
                item.clinicUnitId === unit.id ? { ...item, clinicUnitName: response.unit.name } : item
              )
            }
          : current
      );
      setFeedback("Unidade atualizada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeleteUnit(unit: ClinicUnit) {
    const confirmed = window.confirm(`Deseja excluir a unidade ${unit.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-unit-${unit.id}`);
    setFeedback("");
    try {
      await api.deleteClinicUnit(unit.id);
      setAdminData((current) =>
        current
          ? {
              ...current,
              units: current.units.filter((item) => item.id !== unit.id),
              physicians: current.physicians.map((item) =>
                item.clinicUnitId === unit.id ? { ...item, clinicUnitId: null, clinicUnitName: null } : item
              )
            }
          : current
      );
      setFeedback("Unidade excluida da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreatePhysician(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-physician");
    setFeedback("");

    try {
      const response = await api.createPhysician({
        name: String(formData.get("name") || ""),
        clinicUnitId: Number(formData.get("clinicUnitId") || 0) || null,
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, physicians: [...current.physicians, response.physician].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }
          : current
      );
      form.reset();
      setFeedback("Medico criado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdatePhysician(event: FormEvent<HTMLFormElement>, physician: ClinicPhysician) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`physician-${physician.id}`);
    setFeedback("");

    try {
      const response = await api.updatePhysician(physician.id, {
        name: String(formData.get("name") || physician.name),
        clinicUnitId: Number(formData.get("clinicUnitId") || 0) || null,
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, physicians: current.physicians.map((item) => (item.id === physician.id ? response.physician : item)) }
          : current
      );
      setFeedback("Medico atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeletePhysician(physician: ClinicPhysician) {
    const confirmed = window.confirm(`Deseja excluir o medico ${physician.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-physician-${physician.id}`);
    setFeedback("");
    try {
      await api.deletePhysician(physician.id);
      setAdminData((current) =>
        current ? { ...current, physicians: current.physicians.filter((item) => item.id !== physician.id) } : current
      );
      setFeedback("Medico excluido da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateExam(event: FormEvent<HTMLFormElement>, examConfig: ExamConfig) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`exam-${examConfig.id}`);
    setFeedback("");

    try {
      const response = await api.updateAdminExamConfig(examConfig.id, {
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
      });
      setAdminData((current) =>
        current
          ? { ...current, examConfigs: current.examConfigs.map((item) => (item.id === examConfig.id ? response.examConfig : item)) }
          : current
      );
      setFeedback("Exame atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateMessageTemplate(event: FormEvent<HTMLFormElement>, template: MessageTemplate) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`template-${template.id}`);
    setFeedback("");

    try {
      const response = await api.updateMessageTemplate(template.id, {
        name: String(formData.get("name") || template.name),
        language: String(formData.get("language") || template.language),
        content: String(formData.get("content") || template.content),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? {
              ...current,
              messageTemplates: current.messageTemplates.map((item) => (item.id === template.id ? response.template : item))
            }
          : current
      );
      setFeedback("Template atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o template.");
    } finally {
      setSavingKey("");
    }
  }

  if (loading && !adminData) {
    return <p className="loading-text">Carregando area administrativa...</p>;
  }

  if (!adminData) {
    return <p className="loading-text">Nao foi possivel carregar a area administrativa.</p>;
  }

  const normalizedUserSearch = searchUsers.trim().toLowerCase();
  const normalizedUnitSearch = searchUnits.trim().toLowerCase();
  const normalizedPhysicianSearch = searchPhysicians.trim().toLowerCase();
  const normalizedExamSearch = searchExams.trim().toLowerCase();

  const filteredUsers = adminData.users.filter((user) =>
    !normalizedUserSearch ||
    user.name.toLowerCase().includes(normalizedUserSearch) ||
    user.email.toLowerCase().includes(normalizedUserSearch)
  );

  const filteredUnits = adminData.units.filter((unit) =>
    !normalizedUnitSearch || unit.name.toLowerCase().includes(normalizedUnitSearch)
  );

  const filteredPhysicians = adminData.physicians.filter((physician) =>
    !normalizedPhysicianSearch ||
    physician.name.toLowerCase().includes(normalizedPhysicianSearch) ||
    String(physician.clinicUnitName || "").toLowerCase().includes(normalizedPhysicianSearch)
  );

  const filteredExams = adminData.examConfigs.filter((examConfig) =>
    !normalizedExamSearch ||
    examConfig.name.toLowerCase().includes(normalizedExamSearch) ||
    examConfig.code.toLowerCase().includes(normalizedExamSearch)
  );

  const activeUsersCount = adminData.users.filter((user) => user.active).length;
  const activeUnitsCount = adminData.units.filter((unit) => unit.active).length;
  const activePhysiciansCount = adminData.physicians.filter((physician) => physician.active).length;
  const activeExamsCount = adminData.examConfigs.filter((examConfig) => examConfig.active).length;

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administracao</p>
          <h2>Area administrativa</h2>
          <p className="page-description">
            Gerencie usuarios, unidades, medicos e os exames padrao do protocolo em uma tela simples.
          </p>
        </div>
      </div>

      {feedback ? <p className={feedback.includes("sucesso") ? "form-success" : "form-error"}>{feedback}</p> : null}

      <section className="admin-quick-grid">
        <QuickActionCard
          icon="US"
          title="Novo usuario"
          description="Crie um acesso novo e depois ajuste o perfil ou desative quando precisar."
          actionLabel="Abrir usuarios"
          onAction={() => setActiveTab("usuarios")}
        />
        <QuickActionCard
          icon="UN"
          title="Nova unidade"
          description="Cadastre uma nova unidade para aparecer nos filtros e nos cadastros."
          actionLabel="Abrir cadastros"
          onAction={() => setActiveTab("cadastros")}
        />
        <QuickActionCard
          icon="MD"
          title="Novo medico"
          description="Cadastre o medico e vincule a unidade principal dele."
          actionLabel="Abrir cadastros"
          onAction={() => setActiveTab("cadastros")}
        />
      </section>

      <div className="patient-tabs-bar admin-tabs-bar" role="tablist" aria-label="Abas da area administrativa">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "usuarios"}
          className={`patient-tab-button ${activeTab === "usuarios" ? "active" : ""}`}
          onClick={() => setActiveTab("usuarios")}
        >
          <span>Usuarios</span>
          <span className="patient-tab-count">{filteredUsers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "cadastros"}
          className={`patient-tab-button ${activeTab === "cadastros" ? "active" : ""}`}
          onClick={() => setActiveTab("cadastros")}
        >
          <span>Unidades e medicos</span>
          <span className="patient-tab-count">{filteredUnits.length + filteredPhysicians.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "exames"}
          className={`patient-tab-button ${activeTab === "exames" ? "active" : ""}`}
          onClick={() => setActiveTab("exames")}
        >
          <span>Exames</span>
          <span className="patient-tab-count">{filteredExams.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "mensageria"}
          className={`patient-tab-button ${activeTab === "mensageria" ? "active" : ""}`}
          onClick={() => setActiveTab("mensageria")}
        >
          <span>Mensageria</span>
          <span className="patient-tab-count">{adminData.messageTemplates.length + adminData.messageDeliveryLogs.length}</span>
        </button>
      </div>

      {activeTab === "usuarios" ? (
      <article className="panel-card stack-form" id="admin-users">
        <SectionHeader
          eyebrow="Usuarios"
          title="Gerenciar usuarios"
          description="Apenas administradores podem acessar esta area. Crie perfis e ajuste o tipo de acesso."
        />

        <div className="admin-summary-strip">
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Usuarios ativos</span>
            <strong>{activeUsersCount}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Total de usuarios</span>
            <strong>{adminData.users.length}</strong>
          </div>
        </div>

        <details className="admin-create-box" open>
          <summary>Criar novo usuario</summary>
          <form className="three-columns" onSubmit={handleCreateUser}>
            <label>
              Nome
              <input name="name" placeholder="Nome do usuario" />
            </label>
            <label>
              E-mail
              <input name="email" type="email" placeholder="usuario@clinica.com" />
            </label>
            <label>
              Senha inicial
              <input name="password" type="password" placeholder="Minimo 4 caracteres" />
            </label>
            <label>
              Perfil
              <select name="role" defaultValue="atendente">
                <option value="atendente">Atendente</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <label className="checkbox-row checkbox-row-compact">
              <input name="active" type="checkbox" defaultChecked />
              Usuario ativo
            </label>
            <div className="inline-actions align-end">
              <button className="primary-button" type="submit" disabled={savingKey === "create-user"}>
                {savingKey === "create-user" ? "Salvando..." : "Criar usuario"}
              </button>
            </div>
          </form>
        </details>

        <label>
          Buscar usuario
          <input
            value={searchUsers}
            onChange={(event) => setSearchUsers(event.target.value)}
            placeholder="Buscar por nome ou e-mail"
          />
        </label>

        <div className="settings-grid">
          {filteredUsers.map((user) => (
            <form key={user.id} className="admin-row-card admin-user-card stack-form" onSubmit={(event) => handleUpdateUser(event, user)}>
              <div className="card-row admin-user-card-head">
                <div className="admin-user-title-block">
                  <div className="admin-user-avatar" aria-hidden="true">
                    {user.role === "admin" ? "AD" : "AT"}
                  </div>
                  <div>
                    <strong>{user.name}</strong>
                    <p className="admin-user-subtitle">{user.email}</p>
                  </div>
                </div>
                <div className="priority-badge-row">
                  <span className={`badge ${user.role === "admin" ? "badge-priority-red" : "badge-priority-green"}`}>
                    {user.role === "admin" ? "Administrador" : "Atendente"}
                  </span>
                  <span className={`badge badge-soft ${user.active ? "badge-priority-green" : "badge-priority-red"}`}>
                    {user.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
              <div className="three-columns">
                <label>
                  Nome
                  <input name="name" defaultValue={user.name} />
                </label>
                <label>
                  E-mail
                  <input name="email" type="email" defaultValue={user.email} />
                </label>
                <label>
                  Nova senha
                  <input name="password" type="password" placeholder="Deixe em branco para manter" />
                </label>
              </div>
              <div className="two-columns">
                <label>
                  Perfil
                  <select name="role" defaultValue={user.role}>
                    <option value="atendente">Atendente</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked={user.active} />
                  Usuario ativo
                </label>
              </div>
              <button className="secondary-button" type="submit" disabled={savingKey === `user-${user.id}`}>
                {savingKey === `user-${user.id}` ? "Salvando..." : "Salvar usuario"}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={savingKey === `delete-user-${user.id}`}
                onClick={() => handleDeleteUser(user)}
              >
                {savingKey === `delete-user-${user.id}` ? "Excluindo..." : "Excluir usuario"}
              </button>
            </form>
          ))}
        </div>
      </article>
      ) : null}

      {activeTab === "cadastros" ? (
      <div className="detail-layout admin-layout">
        <article className="panel-card stack-form" id="admin-units">
          <SectionHeader
            eyebrow="Unidades"
            title="Gerenciar unidades"
            description="Mantenha a lista oficial de unidades para filtros, cadastros e relatorios."
          />

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Unidades ativas</span>
              <strong>{activeUnitsCount}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Total de unidades</span>
              <strong>{adminData.units.length}</strong>
            </div>
          </div>

          <details className="admin-create-box" open>
            <summary>Criar nova unidade</summary>
            <form className="two-columns" onSubmit={handleCreateUnit}>
              <label>
                Nome da unidade
                <input name="name" placeholder="Ex.: Unidade Centro" />
              </label>
              <label className="checkbox-row checkbox-row-compact">
                <input name="active" type="checkbox" defaultChecked />
                Unidade ativa
              </label>
              <div className="inline-actions align-end">
                <button className="primary-button" type="submit" disabled={savingKey === "create-unit"}>
                  {savingKey === "create-unit" ? "Salvando..." : "Criar unidade"}
                </button>
              </div>
            </form>
          </details>

          <label>
            Buscar unidade
            <input
              value={searchUnits}
              onChange={(event) => setSearchUnits(event.target.value)}
              placeholder="Buscar por nome da unidade"
            />
          </label>

          <div className="list-grid">
            {filteredUnits.map((unit) => (
              <form key={unit.id} className="admin-row-card admin-entity-card stack-form" onSubmit={(event) => handleUpdateUnit(event, unit)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">UN</div>
                    <div>
                      <strong>{unit.name}</strong>
                      <p className="admin-user-subtitle">Cadastro de unidade da clinica</p>
                    </div>
                  </div>
                  <label className="checkbox-row checkbox-row-compact admin-inline-toggle">
                    <input name="active" type="checkbox" defaultChecked={unit.active} />
                    {unit.active ? "Ativa" : "Inativa"}
                  </label>
                </div>
                <label>
                  Nome
                  <input name="name" defaultValue={unit.name} />
                </label>
                <button className="secondary-button" type="submit" disabled={savingKey === `unit-${unit.id}`}>
                  {savingKey === `unit-${unit.id}` ? "Salvando..." : "Salvar unidade"}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={savingKey === `delete-unit-${unit.id}`}
                  onClick={() => handleDeleteUnit(unit)}
                >
                  {savingKey === `delete-unit-${unit.id}` ? "Excluindo..." : "Excluir unidade"}
                </button>
              </form>
            ))}
          </div>
        </article>

        <article className="panel-card stack-form" id="admin-physicians">
          <SectionHeader
            eyebrow="Medicos"
            title="Gerenciar medicos"
            description="Associe o medico a uma unidade para facilitar filtros e manter o cadastro organizado."
          />

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Medicos ativos</span>
              <strong>{activePhysiciansCount}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Total de medicos</span>
              <strong>{adminData.physicians.length}</strong>
            </div>
          </div>

          <details className="admin-create-box" open>
            <summary>Criar novo medico</summary>
            <form className="three-columns" onSubmit={handleCreatePhysician}>
              <label>
                Nome do medico
                <input name="name" placeholder="Ex.: Dra. Helena Castro" />
              </label>
              <label>
                Unidade
                <select name="clinicUnitId" defaultValue="">
                  <option value="">Sem unidade fixa</option>
                  {adminData.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row checkbox-row-compact">
                <input name="active" type="checkbox" defaultChecked />
                Medico ativo
              </label>
              <div className="inline-actions align-end">
                <button className="primary-button" type="submit" disabled={savingKey === "create-physician"}>
                  {savingKey === "create-physician" ? "Salvando..." : "Criar medico"}
                </button>
              </div>
            </form>
          </details>

          <label>
            Buscar medico
            <input
              value={searchPhysicians}
              onChange={(event) => setSearchPhysicians(event.target.value)}
              placeholder="Buscar por nome ou unidade"
            />
          </label>

          <div className="list-grid">
            {filteredPhysicians.map((physician) => (
              <form key={physician.id} className="admin-row-card admin-entity-card stack-form" onSubmit={(event) => handleUpdatePhysician(event, physician)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">MD</div>
                    <div>
                      <strong>{physician.name}</strong>
                      <p className="admin-user-subtitle">{physician.clinicUnitName || "Sem unidade vinculada"}</p>
                    </div>
                  </div>
                  <label className="checkbox-row checkbox-row-compact admin-inline-toggle">
                    <input name="active" type="checkbox" defaultChecked={physician.active} />
                    {physician.active ? "Ativo" : "Inativo"}
                  </label>
                </div>
                <label>
                  Nome
                  <input name="name" defaultValue={physician.name} />
                </label>
                <label>
                  Unidade
                  <select name="clinicUnitId" defaultValue={physician.clinicUnitId || ""}>
                    <option value="">Sem unidade fixa</option>
                    {adminData.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.name}</option>
                    ))}
                  </select>
                </label>
                <button className="secondary-button" type="submit" disabled={savingKey === `physician-${physician.id}`}>
                  {savingKey === `physician-${physician.id}` ? "Salvando..." : "Salvar medico"}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={savingKey === `delete-physician-${physician.id}`}
                  onClick={() => handleDeletePhysician(physician)}
                >
                  {savingKey === `delete-physician-${physician.id}` ? "Excluindo..." : "Excluir medico"}
                </button>
              </form>
            ))}
          </div>
        </article>
      </div>
      ) : null}

      {activeTab === "exames" ? (
      <article className="panel-card stack-form">
        <SectionHeader
          eyebrow="Exames"
          title="Gerenciar exames padrao"
          description="Ajuste semanas recomendadas, mensagens, antecedencia dos lembretes e se o exame entra ou nao no protocolo."
        />

        <div className="admin-summary-strip">
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Exames ativos</span>
            <strong>{activeExamsCount}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Total de exames</span>
            <strong>{adminData.examConfigs.length}</strong>
          </div>
        </div>

        <label>
          Buscar exame
          <input
            value={searchExams}
            onChange={(event) => setSearchExams(event.target.value)}
            placeholder="Buscar por nome ou codigo"
          />
        </label>

        <div className="settings-grid">
          {filteredExams.map((examConfig) => (
            <form key={examConfig.id} className="admin-row-card admin-exam-card stack-form" onSubmit={(event) => handleUpdateExam(event, examConfig)}>
              <div className="card-row admin-entity-head">
                <div className="admin-user-title-block">
                  <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">EX</div>
                  <div>
                    <strong>{examConfig.name}</strong>
                    <p className="admin-user-subtitle">Codigo: {examConfig.code}</p>
                  </div>
                </div>
                <div className="priority-badge-row">
                  <span className={`badge ${examConfig.required ? "badge-priority-red" : "badge-priority-green"}`}>
                    {examConfig.required ? "Obrigatorio" : "Recomendado"}
                  </span>
                  <span className={`badge badge-soft ${examConfig.active ? "badge-priority-green" : "badge-priority-red"}`}>
                    {examConfig.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
              <label>
                Nome do exame
                <input name="name" defaultValue={examConfig.name} />
              </label>

              <div className="three-columns">
                <label>
                  Semana inicial
                  <input name="startWeek" type="number" min="0" defaultValue={examConfig.startWeek} />
                </label>
                <label>
                  Semana final
                  <input name="endWeek" type="number" min="0" defaultValue={examConfig.endWeek} />
                </label>
                <label>
                  Semana alvo
                  <input name="targetWeek" type="number" min="0" defaultValue={examConfig.targetWeek} />
                </label>
              </div>

              <div className="two-columns">
                <label>
                  Lembrete 1
                  <input name="reminderDaysBefore1" type="number" min="0" defaultValue={examConfig.reminderDaysBefore1} />
                </label>
                <label>
                  Lembrete 2
                  <input name="reminderDaysBefore2" type="number" min="0" defaultValue={examConfig.reminderDaysBefore2} />
                </label>
              </div>

              <div className="three-columns">
                <label className="checkbox-row checkbox-row-compact">
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
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked={examConfig.active} />
                  Exame ativo
                </label>
              </div>

              <label>
                Mensagem padrao de lembrete
                <textarea name="defaultMessage" rows={4} defaultValue={examConfig.defaultMessage} />
              </label>

              <button className="secondary-button" type="submit" disabled={savingKey === `exam-${examConfig.id}`}>
                {savingKey === `exam-${examConfig.id}` ? "Salvando..." : "Salvar exame"}
              </button>
            </form>
          ))}
        </div>
      </article>
      ) : null}

      {activeTab === "mensageria" ? (
      <div className="detail-layout admin-layout">
        <article className="panel-card stack-form">
          <SectionHeader
            eyebrow="Mensageria"
            title="Configuracao futura de integracao"
            description="Arquitetura preparada para integrar WhatsApp Business API no futuro, sem envio real ativo agora."
          />

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Provider atual</span>
              <strong>{adminData.messagingConfig.provider}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Modo de envio</span>
              <strong>{adminData.messagingConfig.dryRun ? "Preparado sem envio real" : "Ativo"}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">API externa pronta</span>
              <strong>{adminData.messagingConfig.isExternalProviderConfigured ? "Configurada" : "Ainda nao configurada"}</strong>
            </div>
          </div>

          <div className="message-metadata">
            <span><strong>Canal:</strong> {adminData.messagingConfig.channel}</span>
            <span><strong>Templates habilitados:</strong> {adminData.messagingConfig.templatesEnabled ? "Sim" : "Nao"}</span>
            <span><strong>Base URL externa:</strong> {adminData.messagingConfig.externalApiBaseUrl || "Nao configurada"}</span>
            <span><strong>Phone Number ID:</strong> {adminData.messagingConfig.externalPhoneNumberId || "Nao configurado"}</span>
          </div>
        </article>

        <article className="panel-card stack-form">
          <SectionHeader
            eyebrow="Templates"
            title="Templates cadastrados"
            description="Modelos salvos para futura integracao com provider externo."
          />

          <div className="list-grid">
            {adminData.messageTemplates.map((template) => (
              <form key={template.id} className="admin-row-card stack-form admin-entity-card" onSubmit={(event) => handleUpdateMessageTemplate(event, template)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">TM</div>
                    <div>
                      <strong>{template.name}</strong>
                      <p className="admin-user-subtitle">Codigo: {template.code}</p>
                    </div>
                  </div>
                  <div className="priority-badge-row">
                    <span className="badge badge-priority-green">{template.channel}</span>
                    <span className={`badge badge-soft ${template.active ? "badge-priority-green" : "badge-priority-red"}`}>
                      {template.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                </div>
                <label>
                  Nome do template
                  <input name="name" defaultValue={template.name} />
                </label>
                <div className="two-columns">
                  <label>
                    Idioma
                    <input name="language" defaultValue={template.language} />
                  </label>
                  <label className="checkbox-row checkbox-row-compact">
                    <input name="active" type="checkbox" defaultChecked={template.active} />
                    Template ativo
                  </label>
                </div>
                <label>
                  Conteudo
                  <textarea name="content" rows={4} defaultValue={template.content} />
                </label>
                <button className="secondary-button" type="submit" disabled={savingKey === `template-${template.id}`}>
                  {savingKey === `template-${template.id}` ? "Salvando..." : "Salvar template"}
                </button>
              </form>
            ))}
          </div>
        </article>

        <article className="panel-card stack-form">
          <SectionHeader
            eyebrow="Logs"
            title="Logs recentes de envio"
            description="Historico tecnico das mensagens registradas, pronto para receber integracao real no futuro."
          />

          <div className="list-grid">
            {adminData.messageDeliveryLogs.length ? adminData.messageDeliveryLogs.map((log) => (
              <div key={log.id} className="admin-row-card stack-form admin-log-card">
                <div className="card-row admin-entity-head">
                  <div>
                    <strong>{log.patientName || "Paciente nao encontrada"}</strong>
                    <p className="admin-user-subtitle">{log.templateName || "Envio sem template vinculado"}</p>
                  </div>
                  <div className="priority-badge-row">
                    <span className="badge badge-priority-green">{log.provider}</span>
                    <span className={`badge badge-soft ${
                      log.status === "erro"
                        ? "badge-priority-red"
                        : log.status === "respondida"
                          ? "badge-priority-green"
                          : log.status === "pendente"
                            ? "badge-priority-yellow"
                            : "badge-priority-green"
                    }`}>
                      {log.status}
                    </span>
                  </div>
                </div>
                <div className="message-metadata">
                  <span><strong>Mensagem:</strong> {log.messageId || "Nao vinculada"}</span>
                  <span><strong>Enviado em:</strong> {log.sentAt || "Nao enviado"}</span>
                  <span><strong>Entrega:</strong> {log.deliveredAt || "Sem retorno"}</span>
                  <span><strong>Resposta:</strong> {log.respondedAt || "Sem resposta"}</span>
                  <span><strong>ID externo:</strong> {log.externalMessageId || "Nao informado"}</span>
                  {log.errorMessage ? <span className="exam-warning-text"><strong>Erro:</strong> {log.errorMessage}</span> : null}
                </div>
              </div>
            )) : <p className="empty-state">Nenhum log de envio registrado ainda.</p>}
          </div>
        </article>
      </div>
      ) : null}
    </section>
  );
}
