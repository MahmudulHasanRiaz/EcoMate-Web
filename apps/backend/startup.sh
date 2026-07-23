#!/bin/sh
set -e

echo "[Startup] Running database migrations..."
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

# ── Build Capacitor APK before server start (full 512MB memory for Gradle) ──
if [ -n "$CLIENT_DOMAIN" ]; then
  APK_PATH="/app/mobile-builds/storefront/android/latest.apk"
  DOMAIN_FILE="/app/mobile-builds/storefront/android/.domain"

  # Check if APK already exists for this CLIENT_DOMAIN
  if [ -f "$APK_PATH" ] && [ -f "$DOMAIN_FILE" ] && [ "$(cat $DOMAIN_FILE)" = "$CLIENT_DOMAIN" ]; then
    echo "[Startup] APK already exists for $CLIENT_DOMAIN — skipping build"
  else
    echo "[Startup] CLIENT_DOMAIN=$CLIENT_DOMAIN — building mobile APK..."

  # Point Gradle cache to persistent volume so SDK isn't re-downloaded on every deploy
  export GRADLE_USER_HOME="/app/mobile-builds/.gradle"
  mkdir -p "$GRADLE_USER_HOME"
  export CAP_APP_ID="${CAP_APP_ID:-com.ecomate.storefront}"
  export CAP_SERVER_URL="https://${CLIENT_DOMAIN}"
  export CAP_APP_NAME="${CAP_APP_NAME:-EcoMate}"

  cd /app/capacitor/storefront

  npm install --no-save --silent 2>/dev/null || true

  # Create capacitor.config.ts with runtime values
  cat > capacitor.config.ts <<CONF
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: '${CAP_APP_ID}',
  appName: '${CAP_APP_NAME}',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    url: '${CAP_SERVER_URL}',
    cleartext: true,
    hostname: '${CLIENT_DOMAIN}',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 2000, backgroundColor: '#ffffff' },
  },
};
export default config;
CONF

  # Add Android platform if not present
  if [ ! -f "android/build.gradle" ]; then
    echo "[Startup] Installing Android platform..."
    npm ls @capacitor/android 2>/dev/null || npm install @capacitor/android --no-save 2>/dev/null || true
    npx cap add android 2>&1 || echo "[Startup] cap add android failed"
  fi

  # Ensure required dirs exist for cap sync
  mkdir -p dist android/app/src/main/assets

  # Sync config changes to native project
  npx cap sync android 2>&1 || echo "[Startup] cap sync android failed"

  # Build APK
  echo "[Startup] Building Android APK..."
  if [ -f "android/gradlew" ]; then
    cat > android/gradle.properties <<PROP
org.gradle.jvmargs=-Xmx256m -XX:MaxMetaspaceSize=128m -XX:+UseSerialGC
org.gradle.daemon=false
PROP
    (cd android && ./gradlew assembleDebug --no-daemon 2>&1) || echo "[Startup] Gradle build failed"
  else
    echo "[Startup] android/gradlew not found — skipping build"
  fi

  # Copy APK output
  APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK_SRC" ]; then
    mkdir -p /app/mobile-builds/storefront/android
    cp "$APK_SRC" /app/mobile-builds/storefront/android/latest.apk
    echo "$CLIENT_DOMAIN" > /app/mobile-builds/storefront/android/.domain
    echo "[Startup] APK ready: /app/mobile-builds/storefront/android/latest.apk"
  fi

  fi

  cd /app
  echo "[Startup] Mobile APK build complete"
fi

echo "[Startup] Starting server..."
exec node dist/src/main
