# Integracao com Shosp

## Objetivo

O Shosp fica como sistema mestre para:

- pacientes
- agenda
- exames e atendimentos realizados

O Medfetus continua como camada operacional para:

- pipeline
- lembretes
- follow up
- revisao manual
- relatorios

## Dados importados do Shosp

Hoje a integracao traz principalmente:

- identificador externo da paciente
- nome, telefone e data de nascimento
- idade gestacional estruturada ou outros dados obstetricos, quando existirem
- medico e unidade de origem
- agenda futura de exames
- exames e atendimentos realizados

## Dados que permanecem no CRM

Continuam sendo mantidos apenas no Medfetus:

- pipeline operacional
- historico de contato
- follow up
- revisao manual da base gestacional
- regras de inferencia e mapeamentos do protocolo
- auditoria de visualizacao e alteracoes relevantes

## Arquitetura de producao

A integracao ficou separada em dois blocos:

- API principal: [C:\Users\Léo\Desktop\Projetos\backend\src\server.js](C:\Users\Léo\Desktop\Projetos\backend\src\server.js)
- worker de sincronizacao: [C:\Users\Léo\Desktop\Projetos\backend\src\shospWorker.js](C:\Users\Léo\Desktop\Projetos\backend\src\shospWorker.js)

Isso evita que sincronizacoes periodicas travem o servidor principal quando o Shosp estiver lento ou offline.

## Variaveis de ambiente

Use como base o arquivo [C:\Users\Léo\Desktop\Projetos\.env.example](C:\Users\Léo\Desktop\Projetos\.env.example).

Variaveis principais:

- `NODE_ENV`
- `DATABASE_URL`
- `SHOSP_API_URL`
- `SHOSP_API_KEY`
- `SHOSP_ACCOUNT_ID`
- `SHOSP_SYNC_INTERVAL`

Variaveis complementares ja suportadas:

- `SHOSP_USE_MOCK`
- `SHOSP_MOCK_FIXTURES`
- `SHOSP_API_TOKEN`
- `SHOSP_USERNAME`
- `SHOSP_PASSWORD`
- `SHOSP_TIMEOUT_MS`
- `SHOSP_PATIENTS_PATH`
- `SHOSP_ATTENDANCES_PATH`
- `SHOSP_EXAMS_PATH`

Configuracao local rapida:

- voce pode preencher o arquivo [C:\Users\Léo\Desktop\Projetos\.env](C:\Users\Léo\Desktop\Projetos\.env) na raiz do projeto
- para ligar a integracao real:
  - `SHOSP_USE_MOCK=false`
  - `SHOSP_API_URL`
  - `SHOSP_API_KEY`
  - `SHOSP_ACCOUNT_ID`
- para reverter rapidamente ao modo seguro/mock:
  - `SHOSP_USE_MOCK=true`
  - `SHOSP_SYNC_INTERVAL=0`

Observacoes:

- `DATABASE_URL` aponta para o arquivo SQLite local. Pode ser caminho absoluto, relativo ou `file:`.
- `SHOSP_SYNC_INTERVAL` fica em milissegundos.
- `SHOSP_SYNC_INTERVAL=0` desativa a sincronizacao periodica.
- credenciais sensiveis do Shosp devem ser configuradas apenas por variaveis de ambiente.
- a interface administrativa nao persiste mais token, API key, usuario ou senha no banco.

## Desenvolvimento sem Shosp

Para trabalhar sem API real:

- `SHOSP_USE_MOCK=true`
- `SHOSP_MOCK_FIXTURES=false`
- `SHOSP_SYNC_INTERVAL=0`

Assim:

- o backend continua funcionando normalmente
- as telas de integracao continuam disponiveis
- nenhuma chamada real e feita ao Shosp
- nenhum paciente ficticio e importado automaticamente

Se voce quiser reativar pacientes ficticios apenas para demonstracao tecnica:

- `SHOSP_USE_MOCK=true`
- `SHOSP_MOCK_FIXTURES=true`

## Como subir em desenvolvimento

Backend principal:

```powershell
npm run dev:backend
```

Frontend:

```powershell
npm run dev:frontend
```

Worker do Shosp, se quiser testar sincronizacao periodica:

```powershell
npm run dev:shosp-worker
```

## Como rodar em producao

Processo 1: API principal

```powershell
npm run start --workspace backend
```

Processo 2: worker de sincronizacao

```powershell
npm run start:shosp-worker --workspace backend
```

Recomendacao:

- manter os dois processos separados no gerenciador de processos da sua infraestrutura
- por exemplo: PM2, Docker Compose, supervisor ou servico do sistema

## Sincronizacao periodica

O worker faz:

- sincronizacao incremental de pacientes
- sincronizacao incremental de atendimentos e exames
- registro de logs
- tratamento de erro sem derrubar o processo principal

Se uma execucao ainda estiver em andamento, o worker nao inicia outra por cima.

## Retry automatico e resiliencia

As chamadas ao Shosp agora possuem:

- retry automatico para timeout
- retry automatico para erro 429
- retry automatico para erros 5xx
- backoff progressivo simples

Se mesmo assim falhar:

- o erro entra em `logs_de_sincronizacao`
- o worker continua vivo
- o servidor principal continua disponivel

## O que ja ficou pronto

- autenticacao obrigatoria da API com sessao
- sincronizacao de pacientes
- sincronizacao de exames e atendimentos
- sincronizacao incremental por cursor
- armazenamento de IDs externos do Shosp
- logs de sincronizacao
- configuracao persistida apenas para parametros nao sensiveis
- modo mock

## Seguranca operacional

- o CRM continua funcionando mesmo se o Shosp estiver offline temporariamente
- o worker de sincronizacao roda separado do servidor principal
- retries e timeout evitam travamento por lentidao externa
- credenciais devem ficar apenas no ambiente do servidor

## Endpoints administrativos

Todos exigem perfil admin.

- `GET /api/admin/integrations/shosp/status`
- `POST /api/admin/integrations/shosp/sync/patients`
- `POST /api/admin/integrations/shosp/sync/attendances`
- `POST /api/admin/integrations/shosp/sync/full`

## Onde ajustar a integracao real depois

Cliente live:

- [C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospApiClient.js](C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospApiClient.js)

Orquestracao:

- [C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospIntegrationService.js](C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospIntegrationService.js)

Worker:

- [C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospSyncWorker.js](C:\Users\Léo\Desktop\Projetos\backend\src\services\shospIntegration\shospSyncWorker.js)
