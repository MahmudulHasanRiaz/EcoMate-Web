import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { MarketingController } from '../marketing.controller';
import { MarketingFundingController } from '../marketing-funding.controller';
import { MarketingAnalysisController } from '../marketing-analysis.controller';
import { MarketingCaptureController } from '../marketing-capture.controller';
import { MarketingWebhooksController } from '../marketing-webhooks.controller';

describe('MarketingController — license gating', () => {
  it('main controller is gated with RequiresFeature(marketing_attribution)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingController)).toBe('marketing_attribution');
  });

  it('funding controller is gated with RequiresFeature(marketing_attribution)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingFundingController)).toBe('marketing_attribution');
  });

  it('analysis controller is gated with RequiresFeature(marketing_attribution)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingAnalysisController)).toBe('marketing_attribution');
  });

  it('main controller requires staff roles (never customer) at class level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MarketingController);
    expect(roles).toEqual(['superadmin', 'admin', 'manager']);
    expect(roles).not.toContain('customer');
  });

  it('analysis controller requires staff roles (never customer)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MarketingAnalysisController);
    expect(roles).toEqual(['superadmin', 'admin', 'manager']);
    expect(roles).not.toContain('customer');
  });

  it('funding endpoints are restricted to superadmin + admin only', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MarketingFundingController);
    expect(roles).toEqual(['superadmin', 'admin']);
  });
});

describe('MarketingCaptureController — public storefront capture', () => {
  it('has NO RequiresFeature metadata (landing capture must never be license-gated)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingCaptureController)).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingCaptureController.prototype.capture),
    ).toBeUndefined();
  });

  it('keeps the storefront-scoped public capture open', () => {
    const ctrl = new MarketingCaptureController({ captureSession: jest.fn() } as any);
    expect(typeof (ctrl as any).capture).toBe('function');
  });
});

describe('MarketingWebhooksController — public ingestion', () => {
  it('has NO RequiresFeature metadata (Meta webhooks must always be accepted)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingWebhooksController)).toBeUndefined();
  });

  it('exposes the GET verify (hub.challenge) and POST webhook handlers', () => {
    const proto = MarketingWebhooksController.prototype;
    expect(typeof proto.verify).toBe('function');
    expect(typeof proto.event).toBe('function');
  });
});