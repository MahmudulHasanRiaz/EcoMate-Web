/**
 * FieldOwnershipService.evaluate() decision-matrix spec — central-commerce §8.3 (P3).
 *
 * Per mapped product and per field F, where `baseline` is the hash of the
 * value EcoMate last pushed (or adopted at first contact):
 * ```
 * ecoNow = hash(ecoMate.current[F]); extNow = provider.readProductFields(...)
 * extChanged = (extNow !== baseline); ecoChanged = (ecoNow !== baseline)
 * !extChanged && !ecoChanged → SKIP
 * !extChanged &&  ecoChanged → PUSH ecoNow
 *  extChanged && !ecoChanged → PRESERVE EXTERNAL (EXTERNAL)
 *  extChanged &&  ecoChanged → PRESERVE EXTERNAL (CONFLICT)
 * ```
 * No case pushes over a drifted external value. First contact (BR-05):
 * a pre-existing external value is adopted as the baseline, never overwritten.
 */
import { FieldOwnershipService } from './field-ownership.service';

describe('FieldOwnershipService.evaluate', () => {
  const svc = new FieldOwnershipService();

  it('SKIP when neither side changed (no API call — no unnecessary traffic)', () => {
    expect(svc.evaluate({ baselineHash: 'a', ecoMateHash: 'a', externalHash: 'a' })).toEqual({
      action: 'SKIP',
      ownership: 'ECOMATE',
    });
  });

  it('PUSH when only EcoMate changed → ownership ECOMATE, baseline advances', () => {
    expect(svc.evaluate({ baselineHash: 'a', ecoMateHash: 'b', externalHash: 'a' })).toEqual({
      action: 'PUSH',
      ownership: 'ECOMATE',
      nextBaselineHash: 'b',
    });
  });

  it('PRESERVE EXTERNAL when only the store drifted → ownership EXTERNAL, no push', () => {
    expect(svc.evaluate({ baselineHash: 'a', ecoMateHash: 'a', externalHash: 'z' })).toEqual({
      action: 'PRESERVE_EXTERNAL',
      ownership: 'EXTERNAL',
    });
  });

  it('PRESERVE CONFLICT when both sides changed → ownership CONFLICT, no push', () => {
    expect(svc.evaluate({ baselineHash: 'a', ecoMateHash: 'b', externalHash: 'z' })).toEqual({
      action: 'PRESERVE_CONFLICT',
      ownership: 'CONFLICT',
    });
  });

  it('never returns a push over a drifted external value', () => {
    for (const ext of ['z', 'a-differs']) {
      const r = svc.evaluate({ baselineHash: 'a', ecoMateHash: 'b', externalHash: ext });
      expect(r.action).not.toBe('PUSH');
      expect(r.action).not.toBe('SKIP');
    }
  });

  describe('first contact — adopt_existing (BR-05)', () => {
    it('adopts a differing external value as baseline with ownership EXTERNAL', () => {
      expect(svc.adoptExisting({ ecoMateHash: 'eco', externalHash: 'ext' })).toEqual({
        ownership: 'EXTERNAL',
        baselineHash: 'ext',
        externalHash: 'ext',
        ecoMateHashAtRebase: 'eco',
      });
    });

    it('adopts a matching external value as a clean ECOMATE baseline', () => {
      expect(svc.adoptExisting({ ecoMateHash: 'same', externalHash: 'same' })).toEqual({
        ownership: 'ECOMATE',
        baselineHash: 'same',
        externalHash: 'same',
        ecoMateHashAtRebase: 'same',
      });
    });

    it('an adopted differing baseline is stable: immediate re-evaluate is SKIP, ownership kept', () => {
      const adopted = svc.adoptExisting({ ecoMateHash: 'eco', externalHash: 'ext' });
      // ecoChanged is measured against ecoMateHashAtRebase (the value EcoMate
      // held at adoption), NOT against the adopted store baseline — otherwise
      // the first sync after adoption would PUSH over the adopted value (BR-05
      // violation). Nothing moved on either side since adoption → SKIP.
      const r = svc.evaluate({
        baselineHash: adopted.baselineHash,
        ecoMateHash: 'eco',
        externalHash: adopted.externalHash,
        ecoMateHashAtRebase: adopted.ecoMateHashAtRebase,
        currentOwnership: adopted.ownership,
      });
      expect(r).toEqual({ action: 'SKIP', ownership: 'EXTERNAL' });
    });

    it('a later EcoMate edit after adoption PUSHes normally (rebase unfreezes the field)', () => {
      const adopted = svc.adoptExisting({ ecoMateHash: 'eco', externalHash: 'ext' });
      const r = svc.evaluate({
        baselineHash: adopted.baselineHash,
        ecoMateHash: 'eco-edited',
        externalHash: adopted.externalHash,
        ecoMateHashAtRebase: adopted.ecoMateHashAtRebase,
        currentOwnership: adopted.ownership,
      });
      expect(r).toEqual({
        action: 'PUSH',
        ownership: 'ECOMATE',
        nextBaselineHash: 'eco-edited',
      });
    });
  });
});
