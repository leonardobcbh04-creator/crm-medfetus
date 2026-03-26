# Validacao Tecnica do Sistema

## Objetivo

Este roteiro automatiza uma checagem rapida dos fluxos principais do Medfetus sem remover funcionalidades do sistema.

## Como rodar

Com backend e frontend em execucao:

```powershell
npm run validate:system
```

## O que a validacao cobre

- testes automatizados do backend
- build do frontend
- resposta do frontend em `http://localhost:5173`
- health check do backend
- autenticacao com usuario administrador
- criacao e leitura de paciente temporaria
- validacao basica da logica gestacional por idade gestacional informada
- carregamento do kanban
- carregamento da central de lembretes
- carregamento dos relatorios
- leitura do status da integracao com Shosp

Ao final, a paciente temporaria criada para teste e removida automaticamente.

## Opcao para testar sincronizacao do Shosp

Por padrao, o script valida apenas o status da integracao. Para executar uma sincronizacao completa manual durante a validacao:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-system.ps1 -RunShospSync
```

Use essa opcao apenas quando fizer sentido operacionalmente, porque ela aciona a rotina de sincronizacao.

## Credenciais usadas

Por padrao, o script usa:

- `admin@clinica.com`
- `123456`

Se quiser adaptar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-system.ps1 -AdminEmail "admin@clinica.com" -AdminPassword "123456"
```

## Quando considerar a validacao aprovada

- nenhuma linha com status `FAIL`
- apenas avisos esperados, como sincronizacao do Shosp nao executada por opcao
- paciente temporaria removida ao final
