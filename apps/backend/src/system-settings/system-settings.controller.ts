import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';
import { MediaResolverService } from '../media/media-resolver.service';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import {
  resolveMetaDestinations,
  publicMetaDestinations,
  validateMetaDestinations,
} from '../tracking/destinations';
import * as nodemailer from 'nodemailer';

interface HeroSlide {
  image: string;
  link?: string;
  alt?: string;
}

interface StoreSystem {
  id: string;
  name: string;
  logo: string;
  display: 'name' | 'logo' | 'name+logo';
}

type CatalogImageRatioPreset = 'square' | '4-3' | '3-4' | '16-9';
type CatalogImageRatioScope = 'all' | 'product' | 'combo';
type CatalogImageRatioMode = 'preset' | 'custom';

interface CatalogImageRatio {
  mode: CatalogImageRatioMode;
  preset?: CatalogImageRatioPreset;
  custom?: { width: number; height: number };
  scope: CatalogImageRatioScope;
}

const DEFAULT_CATALOG_IMAGE_RATIO: CatalogImageRatio = {
  mode: 'preset',
  preset: 'square',
  scope: 'all',
};

function parseCatalogImageRatio(
  raw: string | undefined | null,
): CatalogImageRatio {
  if (!raw) return { ...DEFAULT_CATALOG_IMAGE_RATIO };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CATALOG_IMAGE_RATIO };
  }
  if (!parsed || typeof parsed !== 'object')
    return { ...DEFAULT_CATALOG_IMAGE_RATIO };

  const obj = parsed as Record<string, unknown>;
  const scope: CatalogImageRatioScope =
    obj['scope'] === 'product' ||
    obj['scope'] === 'combo' ||
    obj['scope'] === 'all'
      ? obj['scope']
      : 'all';

  if (
    obj['mode'] === 'custom' &&
    obj['custom'] &&
    typeof obj['custom'] === 'object'
  ) {
    const custom = obj['custom'] as Record<string, unknown>;
    const w = Number(custom['width']);
    const h = Number(custom['height']);
    if (
      Number.isInteger(w) &&
      Number.isInteger(h) &&
      w > 0 &&
      h > 0 &&
      w <= 999 &&
      h <= 999
    ) {
      return { mode: 'custom', custom: { width: w, height: h }, scope };
    }
    return { ...DEFAULT_CATALOG_IMAGE_RATIO, scope };
  }

  if (obj['mode'] === 'preset') {
    const preset: CatalogImageRatioPreset =
      obj['preset'] === 'square' ||
      obj['preset'] === '4-3' ||
      obj['preset'] === '3-4' ||
      obj['preset'] === '16-9'
        ? obj['preset']
        : 'square';
    return { mode: 'preset', preset, scope };
  }

  return { ...DEFAULT_CATALOG_IMAGE_RATIO, scope };
}

function validateCatalogImageRatio(raw: string): CatalogImageRatio {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('catalogImageRatio must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BadRequestException('catalogImageRatio must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const scope: CatalogImageRatioScope =
    obj['scope'] === 'product' ||
    obj['scope'] === 'combo' ||
    obj['scope'] === 'all'
      ? obj['scope']
      : 'all';

  if (obj['mode'] === 'custom') {
    if (!obj['custom'] || typeof obj['custom'] !== 'object') {
      throw new BadRequestException(
        'catalogImageRatio custom requires width and height',
      );
    }
    const custom = obj['custom'] as Record<string, unknown>;
    const w = Number(custom['width']);
    const h = Number(custom['height']);
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      h < 1 ||
      w > 999 ||
      h > 999
    ) {
      throw new BadRequestException(
        'catalogImageRatio custom width and height must be integers between 1 and 999',
      );
    }
    return { mode: 'custom', custom: { width: w, height: h }, scope };
  }

  if (obj['mode'] === 'preset') {
    const preset: CatalogImageRatioPreset =
      obj['preset'] === 'square' ||
      obj['preset'] === '4-3' ||
      obj['preset'] === '3-4' ||
      obj['preset'] === '16-9'
        ? obj['preset']
        : 'square';
    return { mode: 'preset', preset, scope };
  }

  throw new BadRequestException(
    'catalogImageRatio mode must be "preset" or "custom"',
  );
}

@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly mediaResolver: MediaResolverService,
    private readonly cache: CacheService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get()
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_settings')
  async getAll() {
    const settings = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    if (map['smtp_pass']) map['smtp_pass'] = '********';

    // SECRET REDACTION (Step 3). Provider access tokens must not be returned in a
    // list/read response — a settings dump, a support screenshot, or a browser
    // devtools capture would otherwise leak a credential that can write events
    // into a live ad dataset. Presence is reported instead (`*_set`), which is all
    // the editor needs. The write path treats an EMPTY submitted token as "keep the
    // stored one", so redacting here cannot wipe a working credential.
    for (const key of [
      'tracking_meta_access_token',
      'tracking_tiktok_access_token',
    ]) {
      if (map[key]) {
        map[`${key}_set`] = 'true';
        map[key] = '';
      }
    }

    // The destination array carries one token per destination; redact each in
    // place and expose `hasAccessToken` instead.
    if (map['tracking_meta_destinations']) {
      try {
        const parsed = JSON.parse(map['tracking_meta_destinations']);
        if (Array.isArray(parsed)) {
          map['tracking_meta_destinations'] = JSON.stringify(
            parsed.map((raw) => {
              if (!raw || typeof raw !== 'object') return raw;
              const entry = { ...(raw as Record<string, unknown>) };
              const token =
                typeof entry.accessToken === 'string' ? entry.accessToken : '';
              entry.hasAccessToken = !!token;
              entry.accessToken = '';
              return entry;
            }),
          );
        }
      } catch {
        // Malformed stored blob — leave it untouched; the resolver already falls
        // back to the legacy single-pixel settings at delivery time.
      }
    }

    return map;
  }

  @Public()
  @Get('branding')
  async getPublicBranding() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'store_name',
            'admin_title',
            'admin_favicon',
            'admin_tagline',
            'storefront_favicon',
            'storefront_og_image',
            'store_logo',
            'seo_title',
            'seo_description',
          ],
        },
      },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    return {
      storeName: map['store_name'] || '',
      adminTitle: map['admin_title'] || '',
      adminFavicon: map['admin_favicon'] || '',
      adminTagline: map['admin_tagline'] || 'Admin Dashboard',
      storefrontFavicon: map['storefront_favicon'] || '',
      storefrontOgImage: map['storefront_og_image'] || '',
      storeLogo: map['store_logo'] || '',
      seoTitle: map['seo_title'] || '',
      seoDescription: map['seo_description'] || '',
    };
  }

  @Public()
  @Get('storefront')
  async getStorefrontConfig() {
    const cached = await this.cache.get<any>('storefront:config');
    if (cached) return cached;

    let result: any;
    try {
      const settings = await this.prisma.systemSetting.findMany();
      const map: Record<string, string> = {};
      for (const s of settings) map[s.key] = s.value;

      const parseJson = <T>(val: string, fallback: T): T => {
        try {
          return JSON.parse(val);
        } catch {
          return fallback;
        }
      };

      let heroSlides: HeroSlide[] = [];
      try {
        heroSlides = JSON.parse(map['hero_slides'] || '[]');
      } catch {
        heroSlides = [];
      }

      const systems = parseJson<StoreSystem[]>(
        map['store_systems'] || '[]',
        [],
      );

      // Shipping mode
      const shippingMode = map['shipping_mode'] || 'auto_district';

      // Get active shipping options
      let shippingOptions: {
        id: string;
        name: string;
        amount: number;
        sortOrder: number;
      }[] = [];
      try {
        const opts = await this.prisma.shippingOption.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, amount: true, sortOrder: true },
        });
        shippingOptions = opts.map((o) => ({ ...o, amount: Number(o.amount) }));
      } catch {}

      // Get active zone groups
      let shippingZones: {
        id: string;
        type: string;
        amount: number | null;
        districts: string[];
        label: string | null;
      }[] = [];
      try {
        const zones = await this.prisma.shippingZoneGroup.findMany({
          where: { isActive: true },
          select: {
            id: true,
            type: true,
            amount: true,
            districts: true,
            label: true,
          },
        });
        shippingZones = zones.map((z) => ({
          ...z,
          amount: z.amount ? Number(z.amount) : null,
          districts: z.districts as string[],
        }));
      } catch {}

      let homepageSections: any[] = [];
      try {
        homepageSections = JSON.parse(map['homepage_sections'] || '[]');
      } catch {
        homepageSections = [];
      }
      if (!Array.isArray(homepageSections) || homepageSections.length === 0) {
        homepageSections = [
          {
            id: '1',
            title: 'Featured Gadgets',
            type: 'featured',
            limit: 4,
            enabled: true,
          },
          {
            id: '2',
            title: 'New Arrivals',
            type: 'new_arrivals',
            limit: 4,
            enabled: true,
          },
          {
            id: '3',
            title: 'Popular Items',
            type: 'popular',
            limit: 4,
            enabled: true,
          },
        ];
      }

      const result = {
        homepageSections,
        store: {
          name: map['store_name'] || 'EcoMate',
          tagline: map['store_tagline'] || '',
          email: map['store_email'] || '',
          phone: map['store_phone'] || '',
          address: map['store_address'] || '',
        },
        systems,
        currency: {
          code: map['currency'] || 'BDT',
          symbol: map['currency_symbol'] || '৳',
        },
        delivery: {
          charge: parseFloat(map['delivery_charge'] || '0'),
          freeDeliveryMin: parseFloat(map['free_delivery_min'] || '0'),
        },
        hero: {
          slides: heroSlides,
          secondaryBanner: map['hero_secondary_banner'] || '',
          secondaryBannerAlt: map['hero_secondary_banner_alt'] || '',
        },
        social: {
          facebook: map['social_facebook'] || '',
          instagram: map['social_instagram'] || '',
          youtube: map['social_youtube'] || '',
          whatsapp: map['social_whatsapp'] || '',
          messengerUsername: map['social_messenger_username'] || '',
        },
        order: {
          whatsapp: map['order_whatsapp'] || '',
          callNumber: map['order_call_number'] || '',
          blockedPhoneMessage:
            map['blocked_phone_message'] ||
            'This phone number has been blocked. Please contact support.',
        },
        branding: {
          storefrontFavicon: map['storefront_favicon'] || '',
          storefrontOgImage: map['storefront_og_image'] || '',
          storeLogo: map['store_logo'] || '',
          adminTitle: map['admin_title'] || '',
          adminFavicon: map['admin_favicon'] || '',
          adminTagline: map['admin_tagline'] || '',
          colors: {
            primary: map['brand_primary'] || '#0089CD',
            primaryDark: map['brand_primary_dark'] || '#006da3',
            accent: map['brand_accent'] || '#E77250',
            text: map['brand_text'] || '#0a0a0a',
            background: map['brand_bg'] || '#FFFFFF',
            success: map['brand_success'] || '#22C55E',
            danger: map['brand_danger'] || '#EF4444',
            border: map['brand_border'] || '#E5E7EB',
            shadowSoft:
              map['brand_shadow_soft'] || '0 8px 25px rgba(0,137,205,0.15)',
            shadowStrong:
              map['brand_shadow_strong'] ||
              '0 15px 45px -5px rgba(0,137,205,0.6)',
          },
        },
        seo: {
          title: map['seo_title'] || '',
          description: map['seo_description'] || '',
          keywords: map['seo_keywords'] || '',
        },
        footer: {
          description: map['footer_description'] || '',
          copyright: map['footer_copyright'] || '',
        },
        about: {
          text: map['about_us_text'] || '',
        },
        shipping: {
          info: map['shipping_info'] || '',
        },
        payment: {
          info: map['payment_info'] || '',
        },
        meta: {
          pixelEnabled:
            (map['tracking_meta_enabled'] || map['meta_pixel_enabled']) ===
            'true',
          // Legacy single-pixel field, retained for backward compatibility with
          // existing consumers. New code reads `pixelIds`.
          pixelId:
            map['tracking_meta_pixel_id'] || process.env.META_PIXEL_ID || '',
          // Step 3 — multi-pixel browser fan-out. PUBLIC DATA ONLY: this is the
          // browser-safe projection (id/label/pixelId) of the same destination
          // list the server dispatcher uses, resolved by the SAME shared function
          // so the browser can never initialize a pixel the server does not
          // deliver to. Access tokens are structurally excluded from this shape
          // and must never be added to it.
          pixelIds: publicMetaDestinations(
            resolveMetaDestinations(
              map['tracking_meta_destinations'],
              map['tracking_meta_pixel_id'] || process.env.META_PIXEL_ID,
              map['tracking_meta_access_token'] || process.env.META_ACCESS_TOKEN,
            ),
          ).map((d) => d.pixelId),
          purchaseMode: map['tracking_meta_purchase_mode'] || 'instant',
          validatedStatus: map['tracking_meta_validated_status'] || '',
        },
        tiktok: {
          pixelEnabled:
            (map['tracking_tiktok_enabled'] || map['tiktok_pixel_enabled']) ===
            'true',
          pixelCode:
            map['tracking_tiktok_pixel_code'] ||
            process.env.TIKTOK_PIXEL_CODE ||
            '',
          purchaseMode: map['tracking_tiktok_purchase_mode'] || 'instant',
          validatedStatus: map['tracking_tiktok_validated_status'] || '',
        },
        menu: (() => {
          const menuConfig = parseJson<{
            header?: {
              mode?: string;
              showAllCategories?: boolean;
              excludedCategories?: string[];
              items?: any[];
            };
            mobile?: {
              mode?: string;
              showAllCategories?: boolean;
              excludedCategories?: string[];
              items?: any[];
            };
            footer?: { columns?: any[] };
          }>(map['menu_config'], {});
          return {
            header: menuConfig.header || {
              mode: 'include',
              showAllCategories: false,
              excludedCategories: [],
              items: [],
            },
            mobile: menuConfig.mobile || {
              mode: 'include',
              showAllCategories: false,
              excludedCategories: [],
              items: [],
            },
            footer: menuConfig.footer || { columns: [] },
          };
        })(),
        faq: {
          items: parseJson<{ question: string; answer: string }[]>(
            map['faq_items'] || '[]',
            [],
          ),
        },
        hours: {
          label: map['hours_label'] || 'Sat-Thu 10AM-10PM, Fri 3PM-10PM',
          details: parseJson<{ day: string; time: string }[]>(
            map['hours_details'] || '[]',
            [],
          ),
        },
        company: {
          name: map['company_name'] || '',
          registration: map['company_registration'] || '',
          certifications: map['company_certifications'] || '',
          teamSize: map['company_team_size'] || '',
          ceoName: map['company_ceo_name'] || '',
        },
        checkout: {
          districtEnabled: map['checkout_district_enabled'] !== 'false',
          thanaEnabled: map['checkout_thana_enabled'] !== 'false',
          districtRequired: map['checkout_district_required'] === 'true',
          thanaRequired: map['checkout_thana_required'] === 'true',
          // Email collection (approved requirement): enabled default true
          // (field shown), required default false (optional).
          emailEnabled: map['checkout_email_enabled'] !== 'false',
          emailRequired: map['checkout_email_required'] === 'true',
          paymentOptions: await (async () => {
            const paymentOptions: Record<string, boolean> = {
              FULL_PAYMENT: true,
              PARTIAL_PAYMENT: true,
              CASH_ON_DELIVERY: true,
            };
            try {
              const opts = await this.prisma.paymentOption.findMany({
                select: { type: true, enabled: true },
              });
              for (const o of opts) {
                paymentOptions[o.type] = o.enabled;
              }
            } catch {}
            return paymentOptions;
          })(),
        },
        shippingMode,
        shippingOptions,
        shippingZones,
        districtCharges: parseJson<Record<string, number>>(
          map['district_charges'] || '{}',
          {},
        ),
        catalogImageRatio: parseCatalogImageRatio(map['catalogImageRatio']),
        features: {
          sizeChart: map['size_chart_enabled'] === 'true',
          hideOosFromArchive: map['hide_oos_products'] === 'true',
          maintenanceMode: map['maintenance_mode'] === 'true',
          defaultVariantSelected: map['default_variant_selected'] !== 'false',
          showReviews: map['show_reviews'] !== 'false',
        },
        thankYou: {
          title: map['thanks_page_title'] || '',
          subtitle: map['thanks_page_subtitle'] || '',
          description: map['thanks_page_description'] || '',
        },
        playStoreUrl: map['play_store_url'] || '',
        appStoreUrl: map['app_store_url'] || '',
        storefrontPlayStoreUrl: map['storefront_play_store_url'] || '',
        storefrontAppStoreUrl: map['storefront_app_store_url'] || '',
        adminPlayStoreUrl: map['admin_play_store_url'] || '',
        adminAppStoreUrl: map['admin_app_store_url'] || '',
        posPlayStoreUrl: map['pos_play_store_url'] || '',
        posAppStoreUrl: map['pos_app_store_url'] || '',
      };
      const heroImageUrls = [
        ...heroSlides.map(s => s.image).filter(Boolean),
        map['hero_secondary_banner'] || '',
        map['storefront_favicon'] || '',
        map['storefront_og_image'] || '',
        map['store_logo'] || '',
      ].filter(Boolean);

      if (heroImageUrls.length > 0) {
        (result as any)._mediaMeta = await this.mediaResolver.resolve(heroImageUrls);
      }

      await this.cache.set('storefront:config', result);
      return result;
    } catch {
      const stale = await this.cache.getStale<any>('storefront:config');
      if (stale) return stale;
      throw new InternalServerErrorException(
        'Failed to load storefront configuration',
      );
    }
  }

  @Public()
  @Get('admin-manifest')
  async getAdminManifest() {
    const hasMobileDistro = this.featureFlags.canUse('mobile_distribution');
    if (!hasMobileDistro) {
      return {
        name: 'EcoMate Admin',
        short_name: 'EcoMate Admin',
        description: 'Admin dashboard',
        start_url: '/admin/',
        display: 'browser',
        background_color: '#ffffff',
        theme_color: '#2563eb',
      };
    }
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: ['store_name', 'admin_favicon', 'brand_primary', 'brand_bg'] },
      },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    const favicon = map['admin_favicon'] || '/images/favicon.png';
    return {
      name: map['store_name'] || 'EcoMate Admin',
      short_name: map['store_name'] || 'EcoMate Admin',
      description: 'Admin dashboard',
      start_url: '/admin/',
      scope: '/admin/',
      display: 'standalone',
      display_override: ['window-controls-overlay', 'standalone'],
      background_color: map['brand_bg'] || '#ffffff',
      theme_color: map['brand_primary'] || '#2563eb',
      orientation: 'portrait-primary',
      categories: ['business', 'ecommerce'],
      lang: 'en',
      icons: [
        { src: favicon, sizes: '192x192', type: 'image/png' },
        { src: favicon, sizes: '512x512', type: 'image/png' },
        { src: favicon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    };
  }

  @Public()
  @Get('pos-manifest')
  async getPosManifest() {
    const hasMobileDistro = this.featureFlags.canUse('mobile_distribution');
    if (!hasMobileDistro) {
      return {
        name: 'EcoMate POS',
        short_name: 'EcoMate POS',
        description: 'Point of Sale terminal',
        start_url: '/pos/',
        display: 'browser',
        background_color: '#ffffff',
        theme_color: '#2563eb',
      };
    }
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: ['store_name', 'admin_favicon', 'brand_primary', 'brand_bg'] },
      },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    const favicon = map['admin_favicon'] || '/images/favicon.png';
    return {
      name: (map['store_name'] || 'EcoMate') + ' POS',
      short_name: (map['store_name'] || 'EcoMate') + ' POS',
      description: 'Point of Sale terminal',
      start_url: '/pos/',
      scope: '/pos/',
      display: 'standalone',
      display_override: ['window-controls-overlay', 'standalone'],
      background_color: map['brand_bg'] || '#ffffff',
      theme_color: map['brand_primary'] || '#2563eb',
      orientation: 'portrait-primary',
      categories: ['business', 'ecommerce'],
      lang: 'en',
      icons: [
        { src: favicon, sizes: '192x192', type: 'image/png' },
        { src: favicon, sizes: '512x512', type: 'image/png' },
        { src: favicon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    };
  }

  @Public()
  @Get('inventory-enabled')
  async getInventoryEnabled() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'inventory_enabled' },
    });
    return { enabled: setting?.value === 'true' };
  }

  @Get('storage')
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_settings')
  async getStorageConfig() {
    return this.storage.getConfig();
  }

  @Post(':key')
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_settings')
  async set(@Param('key') key: string, @Body() body: { value: string }) {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException('key must be a non-empty string');
    }
    let value = body.value ?? '';

    // Masked-secret convention: an EMPTY submitted value for a redacted secret
    // means "keep the stored one" (the GET handler never returns the token). This
    // is what makes redaction non-destructive.
    if (
      value === '' &&
      (key === 'tracking_meta_access_token' ||
        key === 'tracking_tiktok_access_token')
    ) {
      const stored = await this.prisma.systemSetting.findUnique({
        where: { key },
      });
      if (stored?.value) value = stored.value;
    }

    // Step 3 — Meta destination validation + secret-preserving merge.
    //
    // The destination array is a JSON settings blob with no DB-level constraint,
    // so THIS is the only place its invariants can be enforced: immutable unique
    // ids, a pixel id per live destination, a token per enabled destination, and a
    // cap of 10. Rejecting here also prevents a malformed array from silently
    // zeroing Meta delivery.
    //
    // SECRET HANDLING: list/read responses mask `accessToken` (see the GET
    // handler), so the editor submits an EMPTY token for a destination it did not
    // change. An empty submitted token therefore means "keep the stored one" — it
    // must never wipe a working credential. A destination id that does not yet
    // exist with an empty token is a real validation error (reported below).
    if (key === 'tracking_meta_destinations') {
      // An empty value is a legitimate "no destinations configured" state — the
      // resolver falls back to the legacy single-pixel settings. Only a non-empty
      // value is parsed and validated.
      if (value.trim() === '') {
        value = '';
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          throw new BadRequestException(
            'tracking_meta_destinations must be valid JSON',
          );
        }

        const stored = await this.prisma.systemSetting.findUnique({
          where: { key },
        });
        const storedDestinations = stored?.value
          ? resolveMetaDestinations(stored.value, null, null)
          : [];
        const storedTokenById = new Map(
          storedDestinations.map((d) => [d.id, d.accessToken]),
        );

        if (Array.isArray(parsed)) {
          parsed = parsed.map((raw) => {
            if (!raw || typeof raw !== 'object') return raw;
            const entry = { ...(raw as Record<string, unknown>) };
            const id = typeof entry.id === 'string' ? entry.id : '';
            const submittedToken =
              typeof entry.accessToken === 'string' ? entry.accessToken : '';
            if (!submittedToken && storedTokenById.get(id)) {
              entry.accessToken = storedTokenById.get(id);
            }
            return entry;
          });
        }

        const result = validateMetaDestinations(parsed);
        if (!result.ok) {
          throw new BadRequestException(result.errors.join('; '));
        }
        value = JSON.stringify(result.value);
      }
    }

    // Library-sync any media URLs embedded in the setting being written.
    if (key === 'hero_slides') {
      let slides: HeroSlide[] = [];
      try {
        slides = JSON.parse(value);
        if (!Array.isArray(slides)) slides = [];
      } catch {
        slides = [];
      }
      const urls = slides.map((s) => s?.image).filter((u): u is string => !!u);
      if (urls.length) {
        const synced = await this.media.syncEntityImages(
          'storefront',
          'hero_slides',
          urls,
        );
        let idx = 0;
        slides = slides.map((s) =>
          s?.image ? { ...s, image: synced[idx++] || s.image } : s,
        );
      } else {
        await this.media.detachAll('storefront', 'hero_slides');
      }
      value = JSON.stringify(slides);
    } else if (key === 'hero_secondary_banner') {
      if (value) {
        const [synced] = await this.media.syncEntityImages(
          'storefront',
          'hero_secondary_banner',
          [value],
        );
        if (synced) value = synced;
      } else {
        await this.media.detachAll('storefront', 'hero_secondary_banner');
      }
    } else if (key === 'store_systems') {
      let systems: StoreSystem[] = [];
      try {
        systems = JSON.parse(value);
        if (!Array.isArray(systems)) systems = [];
      } catch {
        systems = [];
      }
      const urls = systems.map((s) => s?.logo).filter((u): u is string => !!u);
      if (urls.length) {
        const synced = await this.media.syncEntityImages(
          'storefront',
          'store_systems',
          urls,
        );
        let idx = 0;
        systems = systems.map((s) =>
          s?.logo ? { ...s, logo: synced[idx++] || s.logo } : s,
        );
      } else {
        await this.media.detachAll('storefront', 'store_systems');
      }
      value = JSON.stringify(systems);
    } else if (key === 'catalogImageRatio') {
      value = JSON.stringify(validateCatalogImageRatio(value));
    }

    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    await this.cache.delete('storefront:config');
    return { key, value };
  }

  @Get('smtp')
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_settings')
  async getSmtpSettings() {
    const keys = [
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_from_email',
      'smtp_from_name',
    ];
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    if (map['smtp_pass']) map['smtp_pass'] = '********';
    return map;
  }

  @Put('smtp')
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_settings')
  async updateSmtpSettings(@Body() body: Record<string, string>) {
    const allowedKeys = [
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_from_email',
      'smtp_from_name',
    ];
    const hasKey = allowedKeys.some((k) => body[k] !== undefined);
    if (!hasKey) {
      throw new BadRequestException(
        'At least one valid SMTP field must be provided',
      );
    }
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        await this.prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: body[key] },
          update: { value: body[key] },
        });
      }
    }
    return { success: true };
  }

  @Post('smtp/test')
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_settings')
  async testSmtp() {
    const keys = [
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_from_email',
      'smtp_from_name',
    ];
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;

    if (!map['smtp_host']) {
      throw new BadRequestException('SMTP not configured');
    }

    const transporter = nodemailer.createTransport({
      host: map['smtp_host'],
      port: parseInt(map['smtp_port'] || '587'),
      secure: map['smtp_port'] === '465',
      auth: map['smtp_user']
        ? {
            user: map['smtp_user'],
            pass: map['smtp_pass'] || '',
          }
        : undefined,
    });

    try {
      await transporter.verify();
    } catch (err) {
      throw new BadRequestException(
        `SMTP verification failed: ${(err as Error).message}`,
      );
    }
    return { success: true, message: 'SMTP connection verified' };
  }
}
