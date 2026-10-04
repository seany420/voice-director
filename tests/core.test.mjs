import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyCues, MARK } from '../js/cues.js';
import { lint, autofix, fingerprint, trigramSet, authenticity, defaultVoice } from '../js/voiceguard.js';
import { newProject, newTake, mergeDirectorResult, unmergeTake } from '../js/model.js';
import { buildSchema, directTake, systemPrompt } from '../js/director.js';
import { crc32, zip } from '../js/export/zip.js';
import { exportFile, FORMATS, printHtml, DEFAULT_EXPORT_OPTS } from '../js/export/index.js';
import { KINDS } from '../js/kinds.js';

// ---------- cues ----------

test('cues: unit breaks, paragraphs, notes, hints', () => {
  const { text, cues } = applyCues('She opens the door. New scene. The kitchen is cold. New paragraph. Note to self check the year. Character note Mara hates the dark.');
  assert.match(text, /⟦BREAK:scene⟧/);
  assert.ok(text.includes(MARK.para));
  assert.match(text, /⟦NOTE⟧ check the year\. ⟦\/NOTE⟧/);
  assert.match(text, /⟦HINT:character⟧ Mara hates the dark/);
  assert.deepEqual(cues.map(c => c.cue), ['break', 'paragraph', 'note', 'hint']);
});

test('cues: scratch that drops the sentence before it', () => {
  const { text } = applyCues('He was 12. He was in Chico. Scratch that. He was in Paradise.');
  assert.equal(text, 'He was 12. He was in Paradise.');
});

test('cues: verbatim spans survive untouched, even with cue words inside', () => {
  const { text } = applyCues('Okay verbatim the fire took everything, scratch that, new scene of my life end verbatim and then we left.');
  assert.ok(text.includes('the fire took everything, scratch that, new scene of my life'));
  assert.ok(!text.includes('⟦BREAK'));
});

// ---------- voice guard ----------

test('voice guard flags em dashes, banned words, negative parallelism', () => {
  const v = defaultVoice();
  const f = lint("It's not burnout, it's grief. We need to leverage the landscape — honestly.", v);
  const types = f.map(x => x.type);
  assert.ok(types.includes('negpar'));
  assert.ok(types.includes('emdash'));
  assert.equal(f.filter(x => x.type === 'word').length, 2);
  assert.equal(lint('I sat in the truck and didn\'t move.', v).filter(x => x.severity === 'high').length, 0);
});

test('voice guard autofix removes em dashes', () => {
  assert.equal(autofix('The smoke—thick and orange—came fast.'), 'The smoke, thick and orange, came fast.');
  assert.ok(!/—/.test(autofix('He left — Done.')));
});

test('fingerprint and authenticity', () => {
  const fp = fingerprint([{ text: "I don't know. Maybe the fire made me this way. I can't say it didn't. My hands still smell like smoke when it rains, which makes no sense, and I've stopped asking it to. Paradise burned. I didn't." }]);
  assert.ok(fp.contractionsPer1k > 50);
  assert.ok(fp.avgSentence > 2);
  const spoken = trigramSet(['so my hands still smell like smoke when it rains you know']);
  assert.ok(authenticity('My hands still smell like smoke when it rains.', spoken) > 0.9);
  assert.ok(authenticity('The olfactory memory of combustion persists in precipitation.', spoken) < 0.1);
});

// ---------- merge ----------

const sample = (u1) => ({
  take_summary: 'Opening at the hospital.',
  logline: 'A therapist who survived a fire.',
  placements: [
    { target: u1 || 'NEW', unit_type: 'scene', title: 'Hospital', group: 'Chapter 1', beat: 'Hook', summary: 'She arrives.', blocks: [
      { type: 'para', text: 'The hallway smelled like bleach.', speaker: '', origin: 'spoken' },
      { type: 'dialogue', text: 'You came back.', speaker: 'Dana', origin: 'spoken' },
      { type: 'tk', text: 'how she got here', speaker: '', origin: 'spoken' },
    ] },
  ],
  entities: [{ ref: '', type: 'character', name: 'Dana', aliases: ['Dee'], summary: 'Night nurse.', details: ['Smokes on breaks'] }],
  flags: [{ kind: 'continuity', text: 'Earlier you said it was winter.' }],
});

test('merge adds units, entities, flags and dedupes entities by name/alias', () => {
  const p = newProject({ title: 'Smoke', kind: 'novel' });
  const t1 = newTake('raw one');
  p.takes.push(t1);
  const r = mergeDirectorResult(p, sample(), t1.id);
  assert.equal(r.newUnits, 1);
  assert.equal(r.blocks, 3);
  assert.equal(p.entities.length, 1);
  assert.equal(p.units[0].beat, 'Hook');
  assert.equal(p.logline, 'A therapist who survived a fire.');

  const t2 = newTake('raw two');
  const s2 = sample(p.units[0].id);
  s2.entities[0].name = 'Dee';
  s2.entities[0].details = ['Smokes on breaks', 'Has a daughter'];
  mergeDirectorResult(p, s2, t2.id);
  assert.equal(p.units.length, 1, 'continued the same unit');
  assert.equal(p.units[0].blocks.length, 6);
  assert.equal(p.entities.length, 1, 'alias matched existing entity');
  assert.deepEqual(p.entities[0].details, ['Smokes on breaks', 'Has a daughter']);

  unmergeTake(p, t2.id);
  assert.equal(p.units[0].blocks.length, 3);
});

// ---------- director (mocked stream) ----------

function sseResponse(json) {
  const text = JSON.stringify(json);
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const body = [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(0, 20) } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(20) } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }),
    ev('message_stop', {}),
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('directTake sends a schema-constrained streaming request and parses the result', async () => {
  const p = newProject({ title: 'Smoke', kind: 'screenplay' });
  const take = newTake('INT hospital night. New scene. Dana says you came back.');
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
    return sseResponse(sample());
  };
  let progress = 0;
  const out = await directTake({ project: p, take, voice: defaultVoice(), settings: { apiKey: 'sk-test', fetch: fakeFetch }, onProgress: n => { progress = n; } });
  assert.equal(out.result.placements[0].title, 'Hospital');
  assert.ok(progress > 0);
  assert.match(sent.url, /\/v1\/messages/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.fallbacks, 'default');
  assert.deepEqual(sent.body.thinking, { type: 'adaptive' });
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.ok(sent.body.messages[0].content.includes('⟦BREAK:scene⟧'));
  assert.ok(sent.body.system[0].cache_control);
});

test('schema: every object is closed and fully required (structured outputs rules)', () => {
  for (const kind of Object.keys(KINDS)) {
    const walk = (s) => {
      if (s.type === 'object') {
        assert.equal(s.additionalProperties, false);
        assert.deepEqual(new Set(s.required), new Set(Object.keys(s.properties)));
        Object.values(s.properties).forEach(walk);
      } else if (s.type === 'array') walk(s.items);
    };
    walk(buildSchema(kind));
  }
});

test('system prompt carries voice rules and banned words', () => {
  const p = newProject({ title: 'X', kind: 'essay' });
  const sp = systemPrompt(p, defaultVoice());
  assert.ok(sp.includes('leverage'));
  assert.ok(sp.includes('Never write em dashes'));
  assert.ok(!/—/.test(sp), 'the prompt itself should model the no-em-dash rule');
});

// ---------- exports ----------

function demoProject(kind) {
  const p = newProject({ title: 'Smoke & Mirrors: "Draft"', kind, author: 'Sean Johnson' });
  const t = newTake('raw');
  p.takes.push(t);
  mergeDirectorResult(p, {
    take_summary: '', logline: 'A town burns.',
    placements: [{ target: 'NEW', unit_type: 'scene', title: 'Parking lot', group: 'Act 1', beat: '', summary: 'Evacuation.', blocks: [
      { type: kind === 'screenplay' ? 'slug' : 'heading', text: 'EXT. HOSPITAL PARKING LOT - DAY', speaker: '', origin: 'spoken' },
      { type: kind === 'screenplay' ? 'action' : 'para', text: 'Orange sky at 9 a.m. Ash like snow. <tags> & ampersands, émigré 🔥.', speaker: '', origin: 'spoken' },
      { type: 'character', text: 'DANA', speaker: '', origin: 'spoken' },
      { type: 'paren', text: 'not looking up', speaker: '', origin: 'spoken' },
      { type: 'dialogue', text: 'Get in the car.', speaker: 'Dana', origin: 'spoken' },
      { type: 'para', text: 'then', speaker: '', origin: 'bridge' },
      { type: 'transition', text: 'CUT TO:', speaker: '', origin: 'spoken' },
      { type: 'tk', text: 'which car', speaker: '', origin: 'spoken' },
    ] }],
    entities: [{ ref: '', type: Object.keys(KINDS[kind].entities)[0], name: 'Dana', aliases: [], summary: 'Nurse.', details: ['Drives a Corolla'] }],
    flags: [{ kind: 'question', text: 'What year?' }],
  }, t.id);
  return p;
}

test('zip: crc32 matches known value and archives extract with unzip', () => {
  assert.equal(crc32(new TextEncoder().encode('hello world')), 0x0d4a1185);
  const dir = mkdtempSync(join(tmpdir(), 'vd-'));
  writeFileSync(join(dir, 'a.zip'), zip([{ name: 'folder/é.txt', data: 'hi' }, { name: 'b.txt', data: new Uint8Array([1, 2, 3]) }]));
  const list = execFileSync('unzip', ['-l', join(dir, 'a.zip')]).toString();
  assert.match(list, /folder\/é\.txt/);
  execFileSync('unzip', ['-t', join(dir, 'a.zip')]);
});

for (const kind of Object.keys(KINDS)) {
  test(`exports for ${kind}: every listed format builds`, () => {
    const p = demoProject(kind);
    for (const fmt of KINDS[kind].exports) {
      if (FORMATS[fmt].print) { assert.ok(printHtml(p, DEFAULT_EXPORT_OPTS).includes('Parking lot') || kind === 'screenplay'); continue; }
      const f = exportFile(p, fmt, { ...DEFAULT_EXPORT_OPTS, includeBible: true });
      assert.ok(f.data.length > 50, `${kind}/${fmt} produced output`);
      assert.ok(f.name.endsWith('.' + FORMATS[fmt].ext));
    }
  });
}

test('docx is a valid package with well-formed XML parts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-'));
  for (const kind of ['novel', 'screenplay', 'academic']) {
    const f = exportFile(demoProject(kind), 'docx', { ...DEFAULT_EXPORT_OPTS, includeBible: true });
    const path = join(dir, `${kind}.docx`);
    writeFileSync(path, f.data);
    execFileSync('unzip', ['-o', '-q', path, '-d', join(dir, kind)]);
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'docProps/core.xml', '_rels/.rels', 'word/_rels/document.xml.rels']) {
      const x = readFileSync(join(dir, kind, part), 'utf8');
      execFileSync('python3', ['-c', 'import sys,xml.dom.minidom;xml.dom.minidom.parseString(sys.stdin.buffer.read())'], { input: x });
    }
  }
});

test('fountain formats a screenplay the way parsers expect', () => {
  const f = exportFile(demoProject('screenplay'), 'fountain').data;
  assert.match(f, /^Title: /);
  assert.match(f, /\nEXT\. HOSPITAL PARKING LOT - DAY\n/);
  assert.match(f, /\nDANA\n\(not looking up\)\nGet in the car\.\n/);
  assert.match(f, /\nCUT TO:\n/);
  assert.match(f, /\[\[TK: which car\]\]/);
});

test('fdx and opml are well-formed XML', () => {
  for (const [kind, fmt] of [['screenplay', 'fdx'], ['novel', 'opml'], ['screenplay', 'opml']]) {
    const x = exportFile(demoProject(kind), fmt).data;
    execFileSync('python3', ['-c', 'import sys,xml.dom.minidom;xml.dom.minidom.parseString(sys.stdin.buffer.read())'], { input: x });
  }
});

test('rtf escapes braces and unicode', () => {
  const r = exportFile(demoProject('novel'), 'rtf').data;
  assert.ok(r.startsWith('{\\rtf1'));
  assert.ok(r.includes('\\u233?'), 'é escaped');
  const open = (r.match(/(?<!\\)\{/g) || []).length, close = (r.match(/(?<!\\)\}/g) || []).length;
  assert.equal(open, close, 'balanced groups');
});

test('json export round-trips', () => {
  const p = demoProject('memoir');
  const back = JSON.parse(exportFile(p, 'json').data);
  assert.equal(back.app, 'voice-director');
  assert.equal(back.project.units[0].blocks.length, p.units[0].blocks.length);
});
