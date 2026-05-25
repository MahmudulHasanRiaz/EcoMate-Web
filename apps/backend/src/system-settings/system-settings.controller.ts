import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
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

    let heroSlides: { image: string; link?: string }[] = [];
    try { heroSlides = JSON.parse(map['hero_slides'] || '[]'); } catch { heroSlides = []; }

    return {
      store: {
        name: map['store_name'] || 'EcoMate',
        tagline: map['store_tagline'] || '',
        email: map['store_email'] || '',
        phone: map['store_phone'] || '',
        address: map['store_address'] || '',
      },
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
      },
      social: {
        facebook: map['social_facebook'] || '',
        instagram: map['social_instagram'] || '',
        youtube: map['social_youtube'] || '',
        whatsapp: map['social_whatsapp'] || '',
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
    };
  }

  @Get('storage')
  async getStorageConfig() {
    return this.storage.getConfig();
  }

  @Post(':key')
  async set(@Param('key') key: string, @Body() body: { value: string }) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: body.value },
      update: { value: body.value },
    });
    return { key, value: body.value };
  }
}
