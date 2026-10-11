import { isSupportedVideoUrl } from '../video-url';

describe('isSupportedVideoUrl', () => {
  it('accepts YouTube watch/shorts/embed/11-char id', () => {
    expect(
      isSupportedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBe(true);
    expect(isSupportedVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedVideoUrl('dQw4w9WgXcQ')).toBe(true);
  });
  it('accepts facebook watch/video urls', () => {
    expect(
      isSupportedVideoUrl('https://www.facebook.com/watch/?v=123456789'),
    ).toBe(true);
  });
  it('rejects empty/arbitrary urls', () => {
    expect(isSupportedVideoUrl('')).toBe(false);
    expect(isSupportedVideoUrl('https://evil.example/x')).toBe(false);
  });
});
