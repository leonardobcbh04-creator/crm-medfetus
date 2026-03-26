$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$checkpointRoot = Join-Path $projectRoot ".checkpoints\mvp-2026-03-16"

if (-not (Test-Path $checkpointRoot)) {
  throw "Checkpoint MVP nao encontrado em $checkpointRoot"
}

function Copy-CheckpointFolder {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path $Source)) {
    return
  }

  New-Item -ItemType Directory -Force $Destination | Out-Null
  robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
}

Copy-Item (Join-Path $checkpointRoot "package.json") (Join-Path $projectRoot "package.json") -Force
Copy-Item (Join-Path $checkpointRoot "package-lock.json") (Join-Path $projectRoot "package-lock.json") -Force
Copy-Item (Join-Path $checkpointRoot ".gitignore") (Join-Path $projectRoot ".gitignore") -Force
Copy-Item (Join-Path $checkpointRoot "README.md") (Join-Path $projectRoot "README.md") -Force

Copy-Item (Join-Path $checkpointRoot "frontend\index.html") (Join-Path $projectRoot "frontend\index.html") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\package.json") (Join-Path $projectRoot "frontend\package.json") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\tsconfig.json") (Join-Path $projectRoot "frontend\tsconfig.json") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\tsconfig.node.json") (Join-Path $projectRoot "frontend\tsconfig.node.json") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\vite.config.ts") (Join-Path $projectRoot "frontend\vite.config.ts") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\vite.config.js") (Join-Path $projectRoot "frontend\vite.config.js") -Force
Copy-Item (Join-Path $checkpointRoot "frontend\vite.config.d.ts") (Join-Path $projectRoot "frontend\vite.config.d.ts") -Force
Copy-Item (Join-Path $checkpointRoot "backend\package.json") (Join-Path $projectRoot "backend\package.json") -Force

Copy-CheckpointFolder -Source (Join-Path $checkpointRoot "frontend\src") -Destination (Join-Path $projectRoot "frontend\src")
Copy-CheckpointFolder -Source (Join-Path $checkpointRoot "backend\src") -Destination (Join-Path $projectRoot "backend\src")
Copy-CheckpointFolder -Source (Join-Path $checkpointRoot "backend\data") -Destination (Join-Path $projectRoot "backend\data")
Copy-CheckpointFolder -Source (Join-Path $checkpointRoot "docs") -Destination (Join-Path $projectRoot "docs")

Write-Host "Checkpoint MVP restaurado com sucesso."
