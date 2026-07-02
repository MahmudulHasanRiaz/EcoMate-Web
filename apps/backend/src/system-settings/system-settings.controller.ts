import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
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
    private readonly cache: CacheService,
  ) {}

  @Get()
  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_settings')
  async getAll() {
    const settings = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
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

    const systems = parseJson<StoreSystem[]>(map['store_systems'] || '[]', []);

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
        pixelId:
          map['tracking_meta_pixel_id'] || process.env.META_PIXEL_ID || '',
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
    };
    await this.cache.set('storefront:config', result);
    return result;
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
    let value = body.value ?? '';

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
    const smtpHost = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_host' },
    });
    const smtpPort = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_port' },
    });
    const smtpUser = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_user' },
    });
    const smtpPass = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_pass' },
    });
    const fromEmail = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_from_email' },
    });
    const fromName = await this.prisma.systemSetting.findUnique({
      where: { key: 'smtp_from_name' },
    });

    if (!smtpHost?.value) {
      throw new BadRequestException('SMTP not configured');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost.value,
      port: parseInt(smtpPort?.value || '587'),
      secure: smtpPort?.value === '465',
      auth: smtpUser?.value
        ? {
            user: smtpUser.value,
            pass: smtpPass?.value || '',
          }
        : undefined,
    });

    await transporter.verify();
    return { success: true, message: 'SMTP connection verified' };
  }
}
