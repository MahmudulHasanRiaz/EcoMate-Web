import { MediaResolverService } from '../media-resolver.service';

/** P3: format-aware resolution must fall back to WebP on old manifests. */
describe('MediaResolverService.resolveFormat (P3)', () => {
  const svc = new MediaResolverService({} as never);
  const newManifest = {
    small: '/u/small.webp',
    small_avif: '/u/small.avif',
    small_jpg: '/u/small.jpg',
  };
  const oldManifest = { small: '/u/small.webp' };

  it('returns the AVIF sibling when present', () => {
    expect(svc.resolveFormat(newManifest, 'small', 'avif')).toBe('/u/small.avif');
  });

  it('falls back to WebP for pre-P3 manifests', () => {
    expect(svc.resolveFormat(oldManifest, 'small', 'avif')).toBe('/u/small.webp');
  });

  it('webp/jpeg resolution and resolveBest are unchanged', () => {
    expect(svc.resolveFormat(newManifest, 'small')).toBe('/u/small.webp');
    expect(svc.resolveFormat(newManifest, 'small', 'jpeg')).toBe('/u/small.jpg');
    expect(svc.resolveFormat(oldManifest, 'small', 'jpeg')).toBe('/u/small.webp');
    expect(svc.resolveBest(newManifest, 'small')).toBe('/u/small.webp');
    expect(svc.resolveFormat(null, 'small', 'avif')).toBeNull();
  });
});
