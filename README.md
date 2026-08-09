# CRM Obstétrico (Medfetus)

Sistema web para gestão de acompanhamento obstétrico, com frontend em React e backend em Node.js/Express, banco de dados PostgreSQL.

## Estrutura do projeto

```text
crm-medfetus/
  frontend/   -> interface React (Vite + TypeScript)
  backend/    -> API Node.js/Express + PostgreSQL
  docs/       -> documentação de segurança, LGPD, integrações e deploy
  scripts/    -> scripts auxiliares (importação, validação, restauração de checkpoint)
```

## Funcionalidades principais

- login com sessão por token e controle de acesso por perfil (`admin`, `recepcao`, `atendimento`);
- limite de tentativas de login (rate limiting) contra força bruta;
- dashboard com indicadores e gráfico de acompanhamento;
- pipeline (kanban) de contato com pacientes;
- cadastro, edição e ficha detalhada de paciente, com importação em lote via planilha;
- motor de cálculo de base gestacional (prioriza dado informado pela equipe > dado estruturado do Shosp > estimativa por exame da clínica > revisão manual), com detecção de conflitos entre fontes;
- configuração de protocolos de exame e vacinas por semana gestacional, com central de lembretes;
- central de contatos unificando mensagens e lembretes;
- integração com o sistema Shosp (agenda/prontuário mestre), com sincronização e modo mock;
- camada de mensageria via WhatsApp preparada na arquitetura, ainda em modo `dry run` (sem envio real ativo);
- auditoria de ações sensíveis (`audit_logs`) e política de retenção de logs configurável.

## Tecnologias

- frontend: React + TypeScript + Vite;
- backend: Node.js + Express;
- banco de dados: **PostgreSQL** (via `pg`), com migrações versionadas em `backend/src/database/postgres/migrations`;
- proteção de login: `express-rate-limit`.

> O projeto usou SQLite na fase inicial, mas o backend hoje é **exclusivamente PostgreSQL** — não há mais suporte a SQLite no código.

## Como rodar localmente

Antes de tudo, você precisa ter `Node.js` e acesso a um banco `PostgreSQL` (local ou na nuvem, ex.: Render, Supabase, Neon).

### 1. Verificar se o Node está instalado

```bash
node -v
npm -v
```

### 2. Configurar variáveis de ambiente

Copie `.env.example` para `.env` na raiz do projeto e preencha `DATABASE_URL` com a string de conexão do seu Postgres, por exemplo:

```text
DATABASE_URL=postgresql://usuario:senha@host:5432/nome_do_banco
```

### 3. Instalar dependências

```bash
npm run install:all
```

### 4. Rodar as migrações e popular dados iniciais

```bash
npm run seed --workspace backend
```

Isso roda as migrações do Postgres e cria os dados de exemplo (usuários, unidades, médicos, modelos de exame).

### 5. Rodar o backend

```bash
npm run dev:backend
```

O backend deve subir em `http://localhost:4000`.

### 6. Rodar o frontend

Em outro terminal:

```bash
npm run dev:frontend
```

O frontend deve abrir em `http://localhost:5173`.

## Login inicial para teste

- e-mail: `admin@clinica.com`
- senha: `123456`

(usuário criado pelo seed; troque a senha antes de usar em produção)

## Segurança do login

O endpoint de login tem limite de 10 tentativas a cada 15 minutos por IP (tentativas bem-sucedidas não contam para o limite). Isso reduz o risco de ataques de força bruta contra as contas dos usuários.

## Arquitetura de mensageria (WhatsApp)

O sistema está preparado para uma integração futura com WhatsApp Business API, mas o envio real ainda não está ativo (`dryRun: true`). Já existem:

- camada separada de mensageria;
- tabela de templates;
- tabela de logs de envio;
- configuração central para provedor externo futuro.

Documentação: [docs/whatsapp-business-integration.md](docs/whatsapp-business-integration.md)

## Integração com o Shosp

O Shosp é tratado como sistema mestre de cadastro, agenda e exames realizados. A integração é opcional (`SHOSP_ENABLED`), tem modo mock para testes sem credenciais reais, e possui timeout, retry e worker de sincronização isolado — falhas no Shosp não derrubam o CRM.

Documentação: [docs/shosp-integration.md](docs/shosp-integration.md)

## Segurança e LGPD

O tratamento de dados de pacientes, política de retenção de logs, controle de acesso e minimização de dados sensíveis estão documentados em [docs/security-lgpd.md](docs/security-lgpd.md). Vale revisar esse documento antes de qualquer uso em produção.

## Deploy

Há um `render.yaml` de referência para publicar no Render (backend como Web Service, frontend como Static Site). **Atenção:** esse arquivo e `docs/deploy-render.md` ainda referenciam SQLite — como o backend agora exige PostgreSQL, revise `DATABASE_URL` nas variáveis de ambiente do serviço antes de publicar.

## Fluxo sugerido para testar

1. Faça login.
2. Veja o dashboard.
3. Abra o kanban e confira os pacientes de exemplo.
4. Cadastre uma nova paciente.
5. Abra a tela de configuração de exames.
6. Edite uma janela de exame.
7. Volte ao kanban e veja os alertas.
8. Confira a central de contatos (mensagens + lembretes unificados).
