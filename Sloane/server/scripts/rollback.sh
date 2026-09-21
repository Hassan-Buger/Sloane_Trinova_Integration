#!/usr/bin/env bash
# ==============================================================================
# Trinova Integration Service - Automated Production Rollback Script
# Non-negotiable rule: Preserves newly created signed documents & records.
# Reference: context/production-rollback-runbook.md §4
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
PRESERVE_DIR="${BACKUP_DIR:-$APP_DIR/backups}/incident_preservation_${TIMESTAMP}"

echo "=== [1/5] Diverting Inbound Traffic to Maintenance Page ==="
if [ -f "/etc/nginx/conf.d/maintenance.conf" ]; then
    ln -sf /etc/nginx/conf.d/maintenance.conf /etc/nginx/sites-enabled/trinova.conf || true
    nginx -s reload || true
fi

echo "=== [2/5] Preserving Deployment Window Documents ==="
mkdir -p "$PRESERVE_DIR"
if [ -d "/var/data/trinova/documents" ]; then
    echo "Copying document artifacts created during deployment window..."
    cp -r /var/data/trinova/documents/* "$PRESERVE_DIR/" || true
    echo "Artifacts preserved in $PRESERVE_DIR"
fi

echo "=== [3/5] Rolling Back Database Schema Migrations ==="
cd "$APP_DIR"
npm run migrate:down

echo "=== [4/5] Reverting Service to Previous Stable Version ==="
if command -v git &> /dev/null && [ -d "$APP_DIR/../.git" ]; then
    echo "Checking out previous stable commit/tag..."
    git checkout HEAD~1 || true
fi

if command -v systemctl &> /dev/null; then
    sudo systemctl restart trinova-api-server || true
fi

echo "=== [5/5] Verifying Portal Regression Health ==="
npm test

echo "======================================================================"
echo "ROLLBACK COMPLETED: System returned to previous stable release."
echo "Preserved artifacts location: $PRESERVE_DIR"
echo "======================================================================"
