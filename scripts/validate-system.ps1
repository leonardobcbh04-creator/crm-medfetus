param(
  [string]$BackendUrl = "http://localhost:4000/api",
  [string]$FrontendUrl = "http://localhost:5173",
  [string]$AdminEmail = "admin@clinica.com",
  [string]$AdminPassword = "123456",
  [switch]$RunShospSync
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message"
}

function Add-Result($Results, [string]$Name, [string]$Status, [string]$Details) {
  $Results.Add([pscustomobject]@{
      Check = $Name
      Status = $Status
      Details = $Details
    }) | Out-Null
}

function Invoke-JsonRequest {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $requestParams = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
    ContentType = "application/json"
  }

  if ($null -ne $Body) {
    $requestParams.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }

  return Invoke-RestMethod @requestParams
}

$results = New-Object System.Collections.Generic.List[object]
$validationPatientId = $null
$authHeaders = @{}

Write-Step "Rodando testes do backend"
try {
  npm run test:backend | Out-Host
  Add-Result $results "Backend tests" "PASS" "Suite do backend executada com sucesso."
} catch {
  Add-Result $results "Backend tests" "FAIL" $_.Exception.Message
}

Write-Step "Rodando build do frontend"
try {
  npm run build --workspace frontend | Out-Host
  Add-Result $results "Frontend build" "PASS" "Build do frontend concluida."
} catch {
  Add-Result $results "Frontend build" "FAIL" $_.Exception.Message
}

Write-Step "Verificando frontend em execucao"
try {
  $frontendResponse = Invoke-WebRequest $FrontendUrl -UseBasicParsing
  Add-Result $results "Frontend online" "PASS" "Status HTTP $($frontendResponse.StatusCode) em $FrontendUrl."
} catch {
  Add-Result $results "Frontend online" "WARN" "Frontend nao respondeu em $FrontendUrl."
}

Write-Step "Verificando backend em execucao"
try {
  $health = Invoke-RestMethod "$BackendUrl/health"
  Add-Result $results "Backend online" "PASS" "Health respondeu com status '$($health.status)'."
} catch {
  Add-Result $results "Backend online" "FAIL" "Backend nao respondeu em $BackendUrl/health."
}

Write-Step "Validando autenticacao"
try {
  $login = Invoke-JsonRequest -Method "POST" -Url "$BackendUrl/auth/login" -Body @{
    email = $AdminEmail
    password = $AdminPassword
  }
  $authHeaders = @{ Authorization = "Bearer $($login.token)" }
  Add-Result $results "Autenticacao" "PASS" "Login efetuado para $($login.user.email)."
} catch {
  Add-Result $results "Autenticacao" "FAIL" "Nao foi possivel autenticar com o usuario informado."
}

if ($authHeaders.Count -gt 0) {
  Write-Step "Validando dashboard"
  try {
    $dashboard = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/dashboard" -Headers $authHeaders
    Add-Result $results "Dashboard" "PASS" "Resumo carregado. Pacientes para contato: $($dashboard.summary.patientsToContactToday)."
  } catch {
    Add-Result $results "Dashboard" "FAIL" $_.Exception.Message
  }

  Write-Step "Validando clientes e logica gestacional"
  try {
    $created = Invoke-JsonRequest -Method "POST" -Url "$BackendUrl/patients" -Headers $authHeaders -Body @{
      name = "Paciente Validacao Automatizada"
      phone = "+55 31 99999-0000"
      birthDate = "1992-03-10"
      dum = "2026-02-01"
      physicianName = "Dra. Helena Castro"
      clinicUnit = "Unidade Centro"
      pregnancyType = "Unica"
      highRisk = $false
      notes = "Paciente criada automaticamente para validacao tecnica."
    }
    $validationPatientId = $created.patient.patient.id
    $details = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/patients/$validationPatientId" -Headers $authHeaders
    $gestationalOk = $details.patient.gestationalBaseSource -eq "dum" -and $details.patient.gestationalBaseConfidence -eq "alta"
    if (-not $gestationalOk) {
      throw "Origem gestacional esperada: dum/alta. Valor atual: $($details.patient.gestationalBaseSource)/$($details.patient.gestationalBaseConfidence)"
    }
    Add-Result $results "Clientes / gestacao" "PASS" "Paciente criada, lida e calculada com DPP $($details.patient.dpp)."
  } catch {
    Add-Result $results "Clientes / gestacao" "FAIL" $_.Exception.Message
  }

  Write-Step "Validando kanban"
  try {
    $kanban = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/kanban" -Headers $authHeaders
    Add-Result $results "Kanban" "PASS" "Kanban carregado com $($kanban.columns.Count) colunas."
  } catch {
    Add-Result $results "Kanban" "FAIL" $_.Exception.Message
  }

  Write-Step "Validando central de lembretes"
  try {
    $reminders = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/reminders" -Headers $authHeaders
    Add-Result $results "Central de lembretes" "PASS" "Fila carregada com $($reminders.items.Count) itens e $($reminders.autoScheduledItems.Count) agendados detectados."
  } catch {
    Add-Result $results "Central de lembretes" "FAIL" $_.Exception.Message
  }

  Write-Step "Validando relatorios"
  try {
    $reports = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/reports" -Headers $authHeaders
    Add-Result $results "Relatorios" "PASS" "Relatorios acessiveis. Pendentes: $($reports.summary.pendingExams)."
  } catch {
    Add-Result $results "Relatorios" "FAIL" $_.Exception.Message
  }

  Write-Step "Validando status da integracao com Shosp"
  try {
    $shospStatus = Invoke-JsonRequest -Method "GET" -Url "$BackendUrl/admin/integrations/shosp/status" -Headers $authHeaders
    Add-Result $results "Shosp status" "PASS" "Modo $($shospStatus.mode). Conectado: $($shospStatus.connection.connected)."

    if ($RunShospSync.IsPresent) {
      $syncResult = Invoke-JsonRequest -Method "POST" -Url "$BackendUrl/admin/integrations/shosp/sync/full" -Headers $authHeaders -Body @{
        incremental = $false
      }
      Add-Result $results "Shosp sync" "PASS" "Pacientes processadas: $($syncResult.patients.recordsProcessed). Atendimentos processados: $($syncResult.attendances.recordsProcessed)."
    } else {
      Add-Result $results "Shosp sync" "WARN" "Sincronizacao nao executada. Use -RunShospSync para validar o fluxo completo."
    }
  } catch {
    Add-Result $results "Shosp status" "FAIL" $_.Exception.Message
  }
}

if ($validationPatientId) {
  Write-Step "Limpando paciente temporaria de validacao"
  try {
    Invoke-JsonRequest -Method "DELETE" -Url "$BackendUrl/patients/$validationPatientId" -Headers $authHeaders | Out-Null
    Add-Result $results "Limpeza da validacao" "PASS" "Paciente temporaria removida."
  } catch {
    Add-Result $results "Limpeza da validacao" "WARN" "Nao foi possivel remover a paciente temporaria de validacao."
  }
}

Write-Step "Resumo da validacao"
$results | Format-Table -AutoSize | Out-Host

$failures = @($results | Where-Object { $_.Status -eq "FAIL" })
$warnings = @($results | Where-Object { $_.Status -eq "WARN" })

Write-Host ""
Write-Host "Falhas: $($failures.Count)"
Write-Host "Avisos: $($warnings.Count)"

if ($failures.Count -gt 0) {
  exit 1
}
