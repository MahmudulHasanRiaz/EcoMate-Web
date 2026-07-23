#!/bin/bash
set -euo pipefail

APP="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAP_DIR="$ROOT/apps/capacitor"

build_app() {
  local name="$1"
  local workspace="$2"
  local cap_app_name="$3"
  local cap_app_id="$4"
  local server_url="${5:-http://localhost:3000}"

  echo "=== Building $name ==="

  # Build web app
  cd "$ROOT"
  npm run build --workspace="$workspace"

  # Setup Capacitor dirs
  mkdir -p "$CAP_DIR/$name"

  # Copy config
  cd "$CAP_DIR/$name"

  # Init native platforms if not present
  if [ ! -d "android" ]; then
    echo "Adding Android platform..."
    CAP_APP_NAME="$cap_app_name" CAP_APP_ID="$cap_app_id" \
      npx cap add android
  fi

  if [ ! -d "ios" ]; then
    echo "Adding iOS platform..."
    CAP_APP_NAME="$cap_app_name" CAP_APP_ID="$cap_app_id" \
      npx cap add ios
  fi

  # Copy web build
  CAP_WEB_DIR="$ROOT/$workspace" CAP_SERVER_URL="$server_url" \
    npx cap copy

  # Sync plugins
  npx cap sync
}

case "$APP" in
  storefront)
    build_app "storefront" "storefront/.next" "EcoMate" "com.ecomate.storefront" "https://domain.com"
    ;;
  admin)
    build_app "admin" "admin/dist" "EcoMate Admin" "com.ecomate.admin" "https://admin.domain.com"
    ;;
  pos)
    build_app "pos" "pos/dist" "EcoMate POS" "com.ecomate.pos" "https://pos.domain.com"
    ;;
  all)
    build_app "storefront" "storefront/.next" "EcoMate" "com.ecomate.storefront" "https://domain.com"
    build_app "admin" "admin/dist" "EcoMate Admin" "com.ecomate.admin" "https://admin.domain.com"
    build_app "pos" "pos/dist" "EcoMate POS" "com.ecomate.pos" "https://pos.domain.com"
    ;;
  *)
    echo "Usage: $0 {storefront|admin|pos|all}"
    exit 1
    ;;
esac

echo "=== $APP build complete ==="
