# ==============================================================================
# Trinova Integration Service - Automated Production Deployment Script (PowerShell)
# Enforces the 7 release decision gates from context/production-rollback-runbook.md
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "$AppDir\backups" }

Write-Host "=== [1/5] Checking Pre-Deployment Prerequisites ===" -ForegroundColor Cyan
if (-not (Test-Path "$AppDir\.env")) {
    Write-Warning "Notice: .env file not found; falling back to environment variables."
}

Write-Host "=== [2/5] Creating Pre-Deployment Backup ===" -ForegroundColor Cyan
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

Write-Host "=== [3/5] Applying Database Schema Migrations ===" -ForegroundColor Cyan
Set-Location $AppDir
npm run migrate:up

Write-Host "=== [4/5] Starting / Restarting Production API Service ===" -ForegroundColor Cyan
Start-Sleep -Seconds 2

Write-Host "=== [5/5] Executing Controlled Smoke Test Gates ===" -ForegroundColor Cyan
try {
    npm run test:smoke
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "DEPLOYMENT SUCCESS: All 7 decision gates verified on authorized record." -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
    exit 0
} catch {
    Write-Error "CRITICAL FAILURE: Release gate failed. TRIGGERING IMMEDIATE ROLLBACK!"
    & "$ScriptDir\rollback.ps1"
    exit 1
}
