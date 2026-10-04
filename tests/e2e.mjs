// End-to-end run of the real app in an iPhone-sized Chromium, with Claude and
// speech recognition faked. Run: node tests/e2e.mjs  (serves the repo on :8765)
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOTS || 'tests/screens';
mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const RESULT = {
  take_summary: 'Opening at the burn unit, Dana meets Sam.',
  logline: 'A night nurse who lost her town to fire has to treat the man who started it.',
  placements: [
    { target: 'NEW', unit_type: 'scene', title: 'The burn unit', group: 'Chapter 1', beat: 'Hook', summary: 'Dana starts her shift and sees the name on the chart.', blocks: [
      { type: 'para', text: 'The burn unit smelled like bleach and something underneath the bleach.', speaker: '', origin: 'spoken' },
      { type: 'para', text: 'Dana read the chart twice. Sam Ricker. Paradise.', speaker: '', origin: 'spoken' },
      { type: 'dialogue', text: 'You don’t remember me.', speaker: 'Sam', origin: 'spoken' },
      { type: 'para', text: 'Then', speaker: '', origin: 'bridge' },
      { type: 'tk', text: 'how long since the fire', speaker: '', origin: 'spoken' },
      { type: 'note', text: 'check if burn units do night charting on paper', speaker: '', origin: 'spoken' },
    ] },
    { target: 'NEW', unit_type: 'scene', title: 'Parking lot', group: 'Chapter 1', beat: 'Inciting incident', summary: 'She smokes and decides not to tell anyone.', blocks: [
      { type: 'para', text: 'She sat in the truck with the engine off — and didn’t move.', speaker: '', origin: 'spoken' },
    ] },
  ],
  entities: [
    { ref: '', type: 'character', name: 'Dana', aliases: [], summary: 'Night nurse on the burn unit. Lost her house in the Camp Fire.', details: ['Smokes in the truck', 'Reads charts twice'] },
    { ref: '', type: 'character', name: 'Sam Ricker', aliases: ['Sam'], summary: 'Patient. From Paradise.', details: ['Knows Dana'] },
    { ref: '', type: 'setting', name: 'Burn unit', aliases: [], summary: 'Hospital ward, nights.', details: ['Bleach smell'] },
  ],
  flags: [
    { kind: 'continuity', text: 'You said Dana quit smoking in an earlier note. Did she start again?' },
    { kind: 'question', text: 'How does Sam know her?' },
  ],
};

function sse(json) {
  const text = JSON.stringify(json);
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...text.match(/[\s\S]{1,200}/g).map(t => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }),
    ev('message_stop', {}),
  ].join('');
}

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => { if (!/fonts\.g/.test(r.url())) errors.push('requestfailed ' + r.url() + ' ' + r.failure()?.errorText); });
page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });

let requests = [];
await page.route('https://api.anthropic.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  requests.push(body);
  if (body.stream) return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: body.output_config?.format ? sse(RESULT) : sse('Act 2 is thin.') });
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) });
});

// Fake speech recognition that "hears" a sentence then ends, like iOS does.
await page.addInitScript(() => {
  class FakeSR {
    start() {
      setTimeout(() => this.onstart?.(), 10);
      const said = window.__said?.shift();
      if (said) setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: false })] });
        setTimeout(() => this.onend?.(), 50);
      }, 60);
    }
    stop() { setTimeout(() => this.onend?.(), 10); }
  }
  window.webkitSpeechRecognition = window.SpeechRecognition = FakeSR;
  window.__said = ['The burn unit smelled like bleach.', 'New scene. She sat in the truck.'];
});

await page.goto('http://127.0.0.1:8765/');
await page.waitForSelector('#v-home.on');
await page.screenshot({ path: `${OUT}/1-home.png` });

// New project
await page.click('#btnNewProject');
await page.fill('#npTitle', 'Smoke Season');
await page.click('[data-k=novel]');
await page.fill('#npAuthor', 'Sean Johnson');
await page.screenshot({ path: `${OUT}/2-new-project.png` });
await page.click('#npSave');
await page.waitForSelector('#v-record.on');

// Live dictation across an auto-restart
await page.click('#btnRec');
await page.waitForTimeout(700);
await page.click('#btnRec');
await page.waitForTimeout(600);
const heard = await page.inputValue('#takeText');
check(heard.includes('bleach') && heard.includes('truck'), 'dictation kept words across a recognizer restart: ' + JSON.stringify(heard));
await page.screenshot({ path: `${OUT}/3-record.png` });

// Direct without a key -> settings sheet opens
await page.click('#btnDirect');
await page.waitForSelector('#stKey');
check(true, 'missing key opens settings');
await page.fill('#stKey', 'sk-ant-test');
await page.click('#stTest');
await page.waitForTimeout(400);
await page.click('#stSave');

// Direct the saved take
await page.click('#takeList [data-a=run]');
await page.waitForFunction(() => window.VD.project?.units.length === 2, null, { timeout: 8000 });
check(true, 'director result merged into 2 scenes');
const req = requests.find(r => r.output_config?.format);
check(req?.model === 'claude-opus-5-5' && req?.thinking?.type === 'adaptive', 'request uses Opus 5.5 with adaptive thinking');
check(req?.messages[0].content.includes('⟦BREAK:scene⟧'), 'spoken "new scene" reached Claude as a marker');

await page.click('#tabs [data-v=draft]');
await page.waitForSelector('.unit');
check(await page.locator('.unit').count() === 2, 'draft shows 2 units');
check(await page.locator('mark.g').count() >= 1, 'voice guard marks the em dash');
check(await page.locator('.blk.bridge').count() === 1, 'bridge words highlighted');
await page.screenshot({ path: `${OUT}/4-draft.png`, fullPage: true });

// Edit a passage
await page.click('.blk.para >> nth=0');
await page.fill('#bsText', 'The burn unit smelled like bleach and something under the bleach.');
await page.click('#bsSave');
await page.waitForTimeout(200);
check((await page.textContent('.unit')).includes('under the bleach'), 'hand edit saved');

await page.click('#tabs [data-v=bible]');
check(await page.locator('.ent').count() === 3, 'bible has 3 entries');
await page.screenshot({ path: `${OUT}/5-bible.png`, fullPage: true });

await page.click('#tabs [data-v=arc]');
check(await page.locator('.beat.filled').count() === 2, 'two beats filled');
check(await page.locator('#questions .q').count() === 2, 'director questions listed');
await page.fill('#askText', 'What is missing?');
await page.click('#btnAsk');
await page.waitForSelector('#askAnswer:not([hidden])');
await page.screenshot({ path: `${OUT}/6-arc.png`, fullPage: true });

await page.click('#tabs [data-v=voice]');
check((await page.textContent('#guardSummary')).includes('em dashes'), 'voice guard summary renders');
await page.click('#btnAddSample');
await page.fill('#ssTitle', 'Substack');
await page.fill('#ssText', "I grew up in Paradise. Then it burned. I don't say that for sympathy. I say it because it's the only sentence that explains the rest, and I've tried a lot of other sentences. Some of them were long and careful and had citations. They didn't work. This one does. My hands still smell like smoke when it rains, which is not possible, and I've stopped arguing with them.");
await page.click('#ssSave');
await page.waitForTimeout(200);
check(!(await page.textContent('#fingerprint')).includes('Add at least'), 'fingerprint built from sample');
await page.click('#btnFixDashes');
await page.screenshot({ path: `${OUT}/7-voice.png`, fullPage: true });

await page.click('#tabs [data-v=export]');
await page.screenshot({ path: `${OUT}/8-export.png`, fullPage: true });
for (const fmt of ['docx', 'scrivener', 'markdown', 'obsidian', 'rtf', 'txt', 'json']) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click(`[data-f=${fmt}]`)]);
  check(/Smoke Season/.test(dl.suggestedFilename()), `export ${fmt} -> ${dl.suggestedFilename()}`);
  await dl.saveAs(`${OUT}/${dl.suggestedFilename()}`);
}

// Reload: project persists
await page.reload();
await page.waitForSelector('#v-draft.on');
check(await page.locator('.unit').count() === 2, 'project survives reload');

check(!errors.length, 'no page errors ' + JSON.stringify(errors));
await browser.close();
server.kill();
if (fail.length) { console.log(`\n${fail.length} failed`); process.exit(1); }
console.log('\nall good');
