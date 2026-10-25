import { describe, it, expect } from 'vitest';
import { stringifyForScript } from '../safe-json';

describe('stringifyForScript', () => {
  it('neutralizes a </script> breakout payload', () => {
    const out = stringifyForScript({
      name: 'x</script><script>alert(1)</script>',
    });
    expect(out).not.toContain('</script>');
    // And it still parses back to the original value.
    expect(JSON.parse(out)).toEqual({
      name: 'x</script><script>alert(1)</script>',
    });
  });

  it('escapes ampersands and round-trips', () => {
    const out = stringifyForScript({ a: 'fish & chips' });
    expect(out).not.toContain('&');
    expect(JSON.parse(out)).toEqual({ a: 'fish & chips' });
  });
});
