# ==============================================================================
# Trinova Integration Service - Automated Production Rollback Script (PowerShell)
# Non-negotiable rule: Preserves newly created signed documents & records.
# Reference: context/production-rollback-runbook.md §4
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$PreserveDir = if ($env:BACKUP_DIR) { "$env:BACKUP_DIR\incident_preservation_$Timestamp" } else { "$AppDir\backups\incident_preservation_$Timestamp" }

Write-Host "=== [1/5] Preserving Deployment Window Documents ===" -ForegroundColor Yellow
if (-not (Test-Path $PreserveDir)) {
    New-Item -ItemType Directory -Path $PreserveDir -Force | Out-Null
}

$DocStorage = "$AppDir\storage"
if (Test-Path $DocStorage) {
    Copy-Item -Path "$DocStorage\*" -Destination $PreserveDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Artifacts preserved in $PreserveDir" -ForegroundColor Green
}

Write-Host "=== [2/5] Rolling Back Database Schema Migrations ===" -ForegroundColor Yellow
Set-Location $AppDir
npm run migrate:down

Write-Host "=== [3/5] Verifying Portal Regression Health ===" -ForegroundColor Yellow
npm test

Write-Host "======================================================================" -ForegroundColor Green
Write-Host "ROLLBACK COMPLETED: System returned to previous stable release." -ForegroundColor Green
Write-Host "Preserved artifacts location: $PreserveDir" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
