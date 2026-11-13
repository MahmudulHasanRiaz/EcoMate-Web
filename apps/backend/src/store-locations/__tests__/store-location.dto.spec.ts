import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateStoreLocationDto } from '../dto/store-location.dto';

describe('CreateStoreLocationDto', () => {
  const base = {
    name: 'Dhaka Showroom',
    type: 'SHOWROOM',
    address: 'Bashundhara City, Dhaka',
  };

  it('accepts a Google Maps short link', async () => {
    const dto = plainToInstance(CreateStoreLocationDto, {
      ...base,
      mapUrl: 'https://maps.app.goo.gl/abc123',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-Maps URL as mapUrl', async () => {
    const dto = plainToInstance(CreateStoreLocationDto, {
      ...base,
      mapUrl: 'https://example.com/somewhere',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'mapUrl')).toBe(true);
  });

  it('rejects a type outside SHOWROOM/BRANCH/OFFICE', async () => {
    const dto = plainToInstance(CreateStoreLocationDto, {
      ...base,
      type: 'WAREHOUSE',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'type')).toBe(true);
  });

  it('rejects a non-URL social link', async () => {
    const dto = plainToInstance(CreateStoreLocationDto, {
      ...base,
      socials: [{ platform: 'Facebook', url: 'not-a-url' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
