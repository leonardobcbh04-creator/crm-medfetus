import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { storeSession } from "../services/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@clinica.com");
  const [password, setPassword] = useState("123456");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await api.login(email, password);
      storeSession(response.token, response.user);
      navigate("/dashboard");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível entrar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <div>
          <p className="eyebrow">CRM obstétrico</p>
          <h1>Entrar no sistema</h1>
          <p className="page-description">
            Esta é a primeira base do projeto, com login de teste para validar todo o fluxo localmente.
          </p>
        </div>

        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            E-mail
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>

          <label>
            Senha
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
