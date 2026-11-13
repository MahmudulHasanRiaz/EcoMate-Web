import { isGoogleMapsUrl } from '../google-maps-url';

describe('isGoogleMapsUrl', () => {
  it.each([
    'https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8',
    'https://www.google.com/maps/place/Dhaka/@23.8,90.4,15z',
    'https://google.com/maps?q=Bashundhara+City',
    'https://maps.google.com/maps?q=Dhaka',
    'http://maps.app.goo.gl/abc123',
  ])('accepts %s', (url) => {
    expect(isGoogleMapsUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/maps',
    'https://www.google.com/search?q=dhaka',
    'https://facebook.com/shop',
    'https://maps.example.com/place',
    'not a url',
    '',
    'https://google.com/maps.evil.com/',
  ])('rejects %s', (url) => {
    expect(isGoogleMapsUrl(url)).toBe(false);
  });
});
