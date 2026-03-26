# Seguranca e LGPD

## Finalidade dos dados

O Medfetus usa dados de pacientes para:

- organizar o acompanhamento gestacional
- sugerir exames e lembretes operacionais
- registrar agenda, realizacao e historico clinico-operacional
- sincronizar cadastro, agenda e realizados vindos do Shosp

O sistema nao deve ser usado para fins diferentes desses sem nova avaliacao juridica e tecnica.

## Dados importados do Shosp

O Shosp e o sistema mestre para:

- cadastro basico da paciente
- dados estruturados de idade gestacional, quando existirem
- agendamentos
- exames/atendimentos realizados

## Dados mantidos no CRM

O Medfetus mantem localmente:

- pipeline operacional
- historico de contato
- lembretes
- follow up
- revisao manual da base gestacional
- mapeamentos tecnicos da integracao

## Credenciais

- credenciais do Shosp devem existir apenas em variaveis de ambiente do backend
- token, API key, usuario e senha nao devem ser salvos no banco
- nunca registrar chave de API em codigo-fonte, logs ou telas administrativas

## Controle de acesso

- autenticacao obrigatoria para uso da API
- perfis suportados:
  - `admin`
  - `recepcao`
  - `atendimento`
- telas administrativas e integracoes restritas a `admin`

## Auditoria

O sistema registra em `audit_logs` eventos relevantes como:

- visualizacao de ficha da paciente
- cadastro e edicao de paciente
- alteracao de exame
- confirmacao/edicao/descarte da base gestacional
- uso operacional de filas sensiveis

## Exportacao de dados

As exportacoes operacionais devem priorizar o minimo necessario.

Regras atuais:

- relatorios CSV nao exportam telefone, observacoes nem notas clinicas livres
- evite criar novos CSVs contendo telefone completo sem necessidade operacional clara

## Logs e minimizacao

- evitar registrar telefone completo em logs
- evitar payloads desnecessarios com dados medicos sensiveis
- em auditoria, telefone deve ser mascarado quando entrar em detalhes

## Retencao recomendada

Politica sugerida:

- `audit_logs`: 12 meses
- `logs_de_sincronizacao`: 90 dias
- logs tecnicos transitórios de integracao: 30 dias

## Limpeza automatica por retencao

O projeto agora executa limpeza automatica de logs no worker do backend.

Escopo atual da limpeza:

- `audit_logs`
- `logs_de_sincronizacao`
- `shosp_sync_logs`
- `message_delivery_logs`

Configuracao por ambiente:

- `AUDIT_LOG_RETENTION_DAYS`
- `SYNC_LOG_RETENTION_DAYS`
- `MESSAGE_LOG_RETENTION_DAYS`
- `LOG_RETENTION_CLEANUP_INTERVAL_HOURS`

Padrao atual:

- auditoria: `365` dias
- sincronizacao: `90` dias
- mensageria tecnica: `30` dias
- frequencia da limpeza: `24` horas

Se houver exigencia contratual ou regulatoria diferente, ajustar a politica formalmente.

## Resiliencia da integracao

- requests externas ao Shosp possuem timeout
- falhas nao derrubam o servidor principal
- worker separado isola sincronizacoes periodicas
- fallback seguro: manter CRM funcionando mesmo com Shosp offline

## Revisao operacional

Antes de producao:

1. configurar credenciais apenas por variaveis de ambiente
2. revisar perfis de acesso por usuario
3. validar politica de retencao com o responsavel juridico/operacional
4. revisar quais exportacoes sao realmente necessarias
