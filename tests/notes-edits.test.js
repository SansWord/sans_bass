import { test, assert, assertEq } from './assert.js';
import { NOTES_EDITS_VERSION, buildEditsPayload, planImport } from '../lib/notes-edits.js';

// ---------------------------------------------------------------- buildEditsPayload

test('notes-edits: buildEditsPayload writes version 2 with stems keyed by id', () => {
  const payload = buildEditsPayload({
    song: 'My Song',
    tempo: { on: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4 },
    tempoRange: null,
    stems: {
      vocals: { interpreter: 'hmm-v1', edits: [] },
      bass: { interpreter: 'hmm-v1', edits: [['x']] },
    },
  });
  assertEq(payload.version, NOTES_EDITS_VERSION, 'carries the current format version');
  assertEq(payload.song, 'My Song', 'song is carried through');
  assertEq(payload.tempo.bpmValue, 120, 'tempo is a single shared object, not per-stem');
  assert('vocals' in payload.stems && 'bass' in payload.stems, 'both stems land under stems{}');
  assertEq(payload.stems.bass.edits.length, 1, 'a stem entry keeps its own edits');
});

test('notes-edits: buildEditsPayload omits song when none is given', () => {
  const payload = buildEditsPayload({ tempo: {}, tempoRange: null, stems: {} });
  assert(!('song' in payload), 'no song field when the caller has no mix loaded');
});

// ---------------------------------------------------------------- planImport: v2 (current format)

test('notes-edits: planImport routes a v2 file\'s stems into apply/skipped by what is loaded', () => {
  const data = {
    version: 2,
    song: 'My Song',
    tempo: { bpmValue: 120 },
    tempoRange: null,
    stems: {
      vocals: { edits: [] },
      guitar: { edits: [] },   // not loaded in this song (yet)
    },
  };
  const plan = planImport(data, ['vocals', 'bass']);
  assert(plan.ok, 'a well-formed v2 file parses');
  assertEq(plan.apply.length, 1, 'only the loaded stem is queued to apply');
  assertEq(plan.apply[0].stem, 'vocals');
  assertEq(plan.skipped.length, 1, 'the not-loaded stem is reported as skipped, not silently dropped');
  assertEq(plan.skipped[0], 'guitar');
});

test('notes-edits: planImport carries shared tempo/tempoRange with explicit presence flags', () => {
  const withRange = planImport({ version: 2, tempo: { bpmValue: 90 }, tempoRange: { from: 1, to: 2 }, stems: {} }, []);
  assert(withRange.hasTempo, 'tempo key was present');
  assertEq(withRange.tempo.bpmValue, 90);
  assert(withRange.hasTempoRange, 'tempoRange key was present, even though non-null');
  assertEq(withRange.tempoRange.from, 1);

  const withoutRange = planImport({ version: 2, stems: {} }, []);
  assert(!withoutRange.hasTempo, 'no tempo key at all means no opinion, not "clear it"');
  assert(!withoutRange.hasTempoRange, 'no tempoRange key at all means no opinion, not "clear it"');
});

// ---------------------------------------------------------------- planImport: invalid input

test('notes-edits: planImport rejects a file that is not a note-edits file at all', () => {
  assertEq(planImport({ hello: 'world' }, ['vocals']).ok, false);
  assertEq(planImport(null, ['vocals']).ok, false);
  assertEq(planImport({ version: 2, stems: [] }, ['vocals']).ok, false, 'stems must be a keyed object, not an array');
});

test('notes-edits: planImport rejects an old single-stem v1 file — no back-compat', () => {
  const oldFile = {
    version: 1,
    stem: 'bass',
    song: 'My Song',
    interpreter: 'hmm-v1',
    params: { minDurationMs: 100 },
    clip: true,
    jianpu: { on: true, tonic: 7, mode: 'minor' },
    tempo: { bpmValue: 90 },
    tempoRange: null,
    edits: [['a']],
  };
  const plan = planImport(oldFile, ['vocals', 'bass']);
  assert(!plan.ok, 'a pre-shared-button single-stem file is just not a recognized format');
  assertEq(plan.reason, 'invalid');
});
