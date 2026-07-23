#!/bin/sh
set -e

echo "[Startup] Running database migrations..."
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

echo "[Startup] Starting server..."
node dist/src/main &

SERVER_PID=$!

# ── Build Capacitor APK in background if CLIENT_DOMAIN is set ──
if [ -n "$CLIENT_DOMAIN" ]; then
  (
    echo "[Startup] CLIENT_DOMAIN=$CLIENT_DOMAIN — building mobile APK..."

    export CAP_APP_ID="${CAP_APP_ID:-com.ecomate.storefront}"
    export CAP_SERVER_URL="https://${CLIENT_DOMAIN}"
    export CAP_APP_NAME="${CAP_APP_NAME:-EcoMate}"

    cd /app/capacitor/storefront

    # Install Capacitor dependencies (package.json exists but node_modules doesn't in Docker)
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
      npx cap add android 2>&1 || echo "[Startup] cap add android failed (will retry next startup)"
    fi

    # Sync config changes to native project
    npx cap sync android 2>&1 || echo "[Startup] cap sync android failed"

    # Build APK
    echo "[Startup] Building Android APK..."
    if [ -f "android/gradlew" ]; then
      (cd android && ./gradlew assembleDebug --no-daemon 2>&1) || echo "[Startup] Gradle build failed"
    else
      echo "[Startup] android/gradlew not found — skipping build"
    fi

    # Copy APK output
    APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_SRC" ]; then
      cp "$APK_SRC" /app/mobile-builds/storefront/android/latest.apk
      echo "[Startup] APK ready: /app/mobile-builds/storefront/android/latest.apk"
    fi

    cd /app
    echo "[Startup] Mobile APK build complete"
  ) &
fi

# Wait for server process
wait $SERVER_PID
