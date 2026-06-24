const addon = require('./build/Release/license_engine');

class LicenseEngine {
  verify(token) {
    const result = JSON.parse(addon.verifyLicense(token));
    if (!result.valid) {
      return { valid: false, features: [] };
    }
    const payload = JSON.parse(
      Buffer.from(result.payload, 'base64url').toString()
    );
    return {
      valid: true,
      clientId: payload.clientId,
      plan: payload.plan,
      packages: payload.packages || [],
      customFeatures: payload.customFeatures || [],
      limits: payload.limits || { cpus: 1, memory: '1G', users: 1, stores: 1 },
      exp: payload.exp,
    };
  }

  canUseFeature(license, featureKey) {
    if (!license || !license.valid) return false;
    const FEATURE_PLAN_MAP = {
      'pos': ['growth', 'enterprise', 'ultimate'],
      'multi-warehouse': ['enterprise', 'ultimate'],
      'advanced-reports': ['enterprise', 'ultimate'],
      'coupons': ['growth', 'enterprise', 'ultimate'],
    };
    const allowedPlans = FEATURE_PLAN_MAP[featureKey];
    if (!allowedPlans) return false;
    if (allowedPlans.includes(license.plan)) return true;
    if (license.customFeatures.includes(featureKey)) return true;
    if (license.packages.includes(featureKey)) return true;
    return false;
  }
}

module.exports = new LicenseEngine();
