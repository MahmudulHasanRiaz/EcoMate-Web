import { SettingsController } from '../settings.controller';

describe('SettingsController', () => {
  it('is defined', () => {
    const controller = new SettingsController({} as any);
    expect(controller).toBeDefined();
  });
});
