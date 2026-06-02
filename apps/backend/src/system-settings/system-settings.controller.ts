import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

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

@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @Roles('superadmin', 'admin', 'manager')
  async getAll() {
    const settings = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    return map;
  }

  @Public()
  @Get('storefront')
  async getStorefrontConfig() {
    const settings = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;

    const parseJson = <T>(val: string, fallback: T): T => {
      try { return JSON.parse(val); } catch { return fallback; }
    };

    let heroSlides: HeroSlide[] = [];
    try { heroSlides = JSON.parse(map['hero_slides'] || '[]'); } catch { heroSlides = []; }

    const systems = parseJson<StoreSystem[]>(map['store_systems'] || '[]', []);

    return {
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
      },
      order: {
        whatsapp: map['order_whatsapp'] || '',
        callNumber: map['order_call_number'] || '',
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
        pixelEnabled: (map['tracking_meta_enabled'] || map['meta_pixel_enabled']) === 'true',
        pixelId: map['tracking_meta_pixel_id'] || process.env.META_PIXEL_ID || '',
      },
      tiktok: {
        pixelEnabled: (map['tracking_tiktok_enabled'] || map['tiktok_pixel_enabled']) === 'true',
        pixelCode: map['tracking_tiktok_pixel_code'] || process.env.TIKTOK_PIXEL_CODE || '',
      },
      navigation: {
        items: parseJson<{ name: string; href: string }[]>(map['navigation_items'] || '[]', []),
      },
      faq: {
        items: parseJson<{ question: string; answer: string }[]>(map['faq_items'] || '[]', []),
      },
      hours: {
        label: map['hours_label'] || 'Sat-Thu 10AM-10PM, Fri 3PM-10PM',
        details: parseJson<{ day: string; time: string }[]>(map['hours_details'] || '[]', []),
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
        paymentModes: parseJson<string[]>(map['checkout_payment_modes'] || '["cod","full","partial"]', ['cod', 'full', 'partial']),
      },
      districtCharges: parseJson<Record<string, number>>(map['district_charges'] || '{}', {}),
    };
  }

  @Get('storage')
  @Roles('superadmin', 'admin')
  async getStorageConfig() {
    return this.storage.getConfig();
  }

  @Post(':key')
  @Roles('superadmin', 'admin', 'manager')
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
    }

    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key, value };
  }
}
