import { describe, expect, it } from 'vitest';
import { chordDetectionReady, detectionView } from '../lib/detection-state.js';

describe('notes detection state', () => {
  it.each([
    ['neither', [{ stem: 'vocals', state: 'absent' }, { stem: 'bass', state: 'absent' }], true, true],
    ['vocals only', [{ stem: 'vocals', state: 'pending' }, { stem: 'bass', state: 'absent' }], false, true],
    ['bass only', [{ stem: 'vocals', state: 'absent' }, { stem: 'bass', state: 'pending' }], false, true],
    ['both complete', [{ stem: 'vocals', state: 'complete' }, { stem: 'bass', state: 'complete' }], true, false],
  ])('derives controls for %s', (_name, channels, disabled, visible) => {
    expect(detectionView(channels)).toMatchObject({ buttonDisabled: disabled, sectionVisible: visible });
  });

  it('keeps the button busy and narrows the status when one channel finishes first', () => {
    expect(detectionView([
      { stem: 'vocals', state: 'complete' }, { stem: 'bass', state: 'running' },
    ])).toEqual({
      sectionVisible: true, buttonDisabled: true, spinnerVisible: true, busyStems: ['bass'],
    });
  });

  it('waits to detect chords until every running note channel finishes', () => {
    expect(chordDetectionReady([{ state: 'complete' }, { state: 'running' }])).toBe(false);
    expect(chordDetectionReady([{ state: 'complete' }, { state: 'complete' }])).toBe(true);
    expect(chordDetectionReady([{ state: 'complete' }, { state: 'absent' }])).toBe(true);
  });
});
