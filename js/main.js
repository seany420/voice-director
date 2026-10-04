import { KINDS, EDIT_LEVELS, BLOCK_TYPES, kindOf } from './kinds.js';
import { newProject, newTake, mergeDirectorResult, unmergeTake, wordCount, spokenWordCount, uid } from './model.js';
import { directTake, askDirector, pingClaude, MODELS } from './director.js';
import { Dictation, speechSupported } from './recorder.js';
import { lint, autofix, fingerprint, describeFingerprint, trigramSet, authenticity, defaultVoice } from './voiceguard.js';
import { FORMATS, exportFile, printHtml, DEFAULT_EXPORT_OPTS } from './export/index.js';
import * as store from './store.js';

// ---------- tiny helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const words = s => (String(s || '').match(/\S+/g) || []).length;
const pct = x => x == null ? '–' : Math.round(x * 100) + '%';

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function sheet(title, html, mount) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  mount?.($('#sheetBody'));
}
const closeSheet = () => { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; };
$('#sheetClose').onclick = closeSheet;
$('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };

// ---------- state ----------
let S = store.loadSettings();
let V = defaultVoice();
let P = null;
let view = 'home';
let mode = 'live';
let dict = null;
let pending = { audio: null, mime: '', seconds: 0 };
let exportOpts = { ...DEFAULT_EXPORT_OPTS };
const queue = [];
let job = null;

async function saveP() { if (P) await store.saveProject(P); }

// ---------- navigation ----------
function rerender() {
  ({ home: renderHome, record: renderRecord, draft: renderDraft, bible: renderBible, arc: renderArc, voice: renderVoice, export: renderExport })[view]?.();
  renderHeader();
}

function show(v) {
  view = v;
  $$('main > section').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#tabs').hidden = v === 'home';
  renderHeader();
  ({ home: renderHome, record: renderRecord, draft: renderDraft, bible: renderBible, arc: renderArc, voice: renderVoice, export: renderExport })[v]?.();
  window.scrollTo({ top: 0 });
}
$$('#tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

function renderHeader() {
  if (!P || view === 'home') {
    $('#hdrIcon').textContent = '🎙';
    $('#hdrTitle').textContent = 'Voice Director';
    $('#hdrSub').textContent = 'Talk it out';
    return;
  }
  const k = kindOf(P.kind);
  $('#hdrIcon').textContent = k.icon;
  $('#hdrTitle').textContent = P.title;
  $('#hdrSub').textContent = `${k.label} · ${EDIT_LEVELS[P.editLevel]?.label || ''} · ${wordCount(P).toLocaleString()} words`;
}

// ---------- home / projects ----------
async function renderHome() {
  const list = (await store.listProjects()).sort((a, b) => b.updated - a.updated);
  $('#projectList').innerHTML = list.length ? list.map(p => {
    const k = kindOf(p.kind);
    return `<div class="item proj" data-id="${p.id}"><span class="ico">${k.icon}</span><div><h3>${h(p.title)}</h3><p>${k.label} · ${p.takes.length} takes · ${wordCount(p).toLocaleString()} words · ${fmtDate(p.updated)}</p></div></div>`;
  }).join('') : '<p class="muted small center">No projects yet.</p>';
  $$('#projectList .proj').forEach(el => el.onclick = () => openProject(el.dataset.id));
}

async function openProject(id) {
  const p = await store.getProject(id);
  if (!p) return show('home');
  P = p;
  S.lastProject = p.id;
  store.saveSettings(S);
  closeSheet();
  show(p.takes.length ? 'draft' : 'record');
}

function projectSheet(existing) {
  const p = existing;
  let kind = p?.kind || 'novel';
  let level = p?.editLevel || 'clean';
  sheet(p ? 'Project settings' : 'New project', `
    <label>Title</label><input type="text" id="npTitle" value="${h(p?.title || '')}" placeholder="Working title">
    <label>What is it?</label>
    <div class="kinds">${Object.entries(KINDS).map(([id, k]) => `<button data-k="${id}" class="${id === kind ? 'on' : ''}">${k.icon} ${k.label}<small>${Object.values(k.entities).slice(0, 3).join(', ')}</small></button>`).join('')}</div>
    <label>How much should the Director touch your words?</label>
    <div class="kinds">${Object.entries(EDIT_LEVELS).map(([id, l]) => `<button data-l="${id}" class="${id === level ? 'on' : ''}">${l.label}<small>${l.blurb}</small></button>`).join('')}</div>
    <label>Author name (for title pages)</label><input type="text" id="npAuthor" value="${h(p?.author ?? S.author)}">
    <div class="row gap mt"><button id="npSave" class="primary">${p ? 'Save' : 'Create'}</button>${p ? '<button id="npDelete" class="ghost danger">Delete project</button>' : ''}</div>
    ${p && p.takes.length ? '<p class="muted small">Changing the type keeps your takes. Use “Rebuild project from all takes” on the Record tab to re-sort everything under the new type.</p>' : ''}
  `, el => {
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; el.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { level = b.dataset.l; el.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelector('#npSave').onclick = async () => {
      const title = el.querySelector('#npTitle').value.trim() || 'Untitled';
      const author = el.querySelector('#npAuthor').value.trim();
      if (author && author !== S.author) { S.author = author; store.saveSettings(S); }
      if (p) {
        Object.assign(P, { title, kind, editLevel: level, author });
        await saveP();
        closeSheet();
        rerender();
      } else {
        P = newProject({ title, kind, author, editLevel: level });
        await saveP();
        S.lastProject = P.id;
        store.saveSettings(S);
        closeSheet();
        show('record');
      }
    };
    el.querySelector('#npDelete')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${P.title}” and all its takes? Export a backup first if you want one.`)) return;
      for (const t of P.takes) if (t.audioId) await store.deleteAudio(t.audioId);
      await store.deleteProject(P.id);
      P = null;
      closeSheet();
      show('home');
    });
  });
}
$('#btnNewProject').onclick = () => projectSheet(null);

$('#btnProjects').onclick = async () => {
  const list = (await store.listProjects()).sort((a, b) => b.updated - a.updated);
  sheet('Projects', `
    ${P ? '<button id="psEdit" class="ghost wide">⚙︎ This project: title, type, edit level</button>' : ''}
    <div class="list mt">${list.map(p => `<div class="item proj" data-id="${p.id}"><span class="ico">${kindOf(p.kind).icon}</span><div><h3>${h(p.title)}${P?.id === p.id ? ' <span class="pill ok">open</span>' : ''}</h3><p>${kindOf(p.kind).label} · ${p.takes.length} takes</p></div></div>`).join('')}</div>
    <button id="psNew" class="primary wide mt">+ New project</button>
    <button id="psHome" class="ghost wide mt">All projects</button>
  `, el => {
    el.querySelectorAll('.proj').forEach(x => x.onclick = () => openProject(x.dataset.id));
    el.querySelector('#psNew').onclick = () => projectSheet(null);
    el.querySelector('#psHome').onclick = () => { closeSheet(); show('home'); };
    el.querySelector('#psEdit')?.addEventListener('click', () => projectSheet(P));
  });
};

// ---------- record ----------
function setMode(m) {
  mode = m;
  $$('.modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#liveBox').hidden = m !== 'live';
  $('#typeHint').hidden = m !== 'type';
  $('#takeText').placeholder = m === 'paste'
    ? 'Paste a Voice Memos transcript, notes from another app, anything.'
    : m === 'type' ? 'Tap here, then the mic on your keyboard.' : 'Your words land here. You can fix anything before the Director sees it.';
  let imp = $('#btnImportTake');
  if (m === 'paste' && !imp) {
    imp = document.createElement('button');
    imp.id = 'btnImportTake';
    imp.className = 'ghost small';
    imp.textContent = 'Import a text file';
    imp.onclick = () => pickTextFiles(texts => { $('#takeText').value = ($('#takeText').value + '\n\n' + texts.join('\n\n')).trim(); autosave(); });
    $('#takeText').before(imp);
  } else if (m !== 'paste' && imp) imp.remove();
  if (m === 'type') $('#takeText').focus();
}
$$('.modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

function renderRecord() {
  if (!speechSupported() && mode === 'live') {
    $('#recState').textContent = 'Live dictation isn’t available in this browser. Use Type mode and the keyboard mic.';
  }
  renderTakes();
}

let timerInt;
$('#btnRec').onclick = async () => {
  if (dict?.active) return stopRec();
  dict = new Dictation({
    lang: S.lang,
    keepAudio: S.keepAudio,
    onText: t => { const ta = $('#takeText'); ta.value = t; ta.scrollTop = ta.scrollHeight; },
    onState: s => { $('#recState').textContent = { starting: 'Starting…', listening: 'Listening. Talk like nobody’s reading.', stopped: 'Stopped. Edit below, then direct it.' }[s] || s; },
    onLevel: drawLevel,
    onError: msg => toast(msg, 5000),
  });
  dict.seed($('#takeText').value);
  try {
    await dict.start();
  } catch (err) {
    toast(err.message, 5000);
    return setMode('type');
  }
  $('#btnRec').classList.add('on');
  timerInt = setInterval(() => { $('#recTime').textContent = fmtTime(dict.seconds); autosave(); }, 1000);
};

async function stopRec() {
  if (!dict?.active) return;
  clearInterval(timerInt);
  $('#btnRec').classList.remove('on');
  const r = await dict.stop();
  $('#takeText').value = r.text;
  $('#recTime').textContent = fmtTime(r.seconds);
  pending = { audio: r.audio || pending.audio, mime: r.mime || pending.mime, seconds: r.seconds };
  drawLevel(0);
  autosave();
}

function drawLevel(v) {
  const c = $('#meter'), x = c.getContext('2d');
  const w = c.width, hh = c.height;
  x.clearRect(0, 0, w, hh);
  x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--rec');
  const bars = 30;
  for (let i = 0; i < bars; i++) {
    const amp = Math.max(0.06, Math.min(1, v * 2.4 * (0.5 + Math.random() * 0.6)));
    const bh = amp * hh;
    x.fillRect(i * (w / bars) + 1, (hh - bh) / 2, w / bars - 3, bh);
  }
}

let lastAuto = 0;
function autosave() {
  if (!P) return;
  if (Date.now() - lastAuto < 3000) return;
  lastAuto = Date.now();
  store.saveDraftTake({ projectId: P.id, text: $('#takeText').value, seconds: pending.seconds || dict?.seconds || 0, at: Date.now() });
}
$('#takeText').addEventListener('input', autosave);

async function commitTake() {
  if (dict?.active) await stopRec();
  const raw = $('#takeText').value.trim();
  if (!raw) { toast('Nothing to save yet. Talk first.'); return null; }
  const take = newTake(raw, { durationSec: pending.seconds || 0, source: mode });
  if (pending.audio) {
    take.audioId = uid('a_');
    await store.saveAudio(take.audioId, pending.audio, pending.mime);
  }
  P.takes.push(take);
  await saveP();
  await store.clearDraftTake();
  $('#takeText').value = '';
  $('#recTime').textContent = '0:00';
  pending = { audio: null, mime: '', seconds: 0 };
  dict = null;
  renderTakes();
  renderHeader();
  return take;
}

$('#btnSaveTake').onclick = async () => { if (await commitTake()) toast('Take saved.'); };
$('#btnDirect').onclick = async () => {
  const t = await commitTake();
  if (!t) return;
  if (!S.apiKey) { toast('Take saved. Add your Claude API key in Settings to direct it.', 4500); return settingsSheet(); }
  enqueue([t.id]);
};
$('#btnDiscard').onclick = async () => {
  if ($('#takeText').value.trim() && !confirm('Throw away this take?')) return;
  if (dict?.active) { await dict.stop(); clearInterval(timerInt); $('#btnRec').classList.remove('on'); }
  dict = null;
  $('#takeText').value = '';
  $('#recTime').textContent = '0:00';
  pending = { audio: null, mime: '', seconds: 0 };
  await store.clearDraftTake();
};

function renderTakes() {
  if (!P) return;
  $('#takeCount').textContent = P.takes.length ? `(${P.takes.length})` : '';
  const pill = t => t.status === 'done' ? '<span class="pill ok">directed</span>' : t.status === 'error' ? '<span class="pill bad">error</span>' : queue.includes(t.id) || job?.takeId === t.id ? '<span class="pill warn">in line</span>' : '<span class="pill">not directed</span>';
  $('#takeList').innerHTML = [...P.takes].reverse().map(t => `
    <div class="item" data-id="${t.id}">
      <div class="meta">${pill(t)}<span>${fmtDate(t.created)}</span><span>${words(t.raw)} words</span>${t.durationSec ? `<span>${fmtTime(t.durationSec)}</span>` : ''}${t.audioId ? '<span>🔊</span>' : ''}</div>
      <p class="small" style="margin:6px 0 0">${h(t.summary || t.raw.slice(0, 160) + (t.raw.length > 160 ? '…' : ''))}</p>
      ${t.error ? `<p class="small" style="color:var(--rec);margin:4px 0 0">${h(t.error)}</p>` : ''}
      <div class="actions"><button class="small ghost" data-a="open">Open</button><button class="small ghost" data-a="run">${t.status === 'done' ? 'Re-direct' : 'Direct'}</button><button class="small ghost danger" data-a="del">Delete</button></div>
    </div>`).join('') || '<p class="muted small">No takes yet. Hit the red button and start talking.</p>';
  $$('#takeList .item').forEach(el => {
    const t = P.takes.find(x => x.id === el.dataset.id);
    el.querySelector('[data-a=open]').onclick = () => takeSheet(t);
    el.querySelector('[data-a=run]').onclick = () => {
      if (!S.apiKey) return settingsSheet();
      if (t.status === 'done') unmergeTake(P, t.id);
      enqueue([t.id]);
    };
    el.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('Delete this take and everything the Director placed from it?')) return;
      unmergeTake(P, t.id);
      if (t.audioId) await store.deleteAudio(t.audioId);
      P.takes = P.takes.filter(x => x !== t);
      await saveP();
      renderTakes();
      renderHeader();
    };
  });
}

async function takeSheet(t) {
  sheet('Take', `
    <div class="meta muted small">${fmtDate(t.created)} · ${words(t.raw)} words${t.cues?.length ? ` · ${t.cues.length} cues heard` : ''}</div>
    <div id="tsAudio"></div>
    <label>What you said (edit, then re-direct to apply)</label>
    <textarea id="tsRaw" rows="12" style="font-family:var(--prose)">${h(t.raw)}</textarea>
    ${t.cues?.length ? `<p class="muted small">Cues: ${t.cues.map(c => c.cue + (c.unit ? ':' + c.unit : '') + (c.hint ? ':' + c.hint : '')).join(', ')}</p>` : ''}
    <div class="row gap wrap mt"><button id="tsSave" class="primary">Save</button><button id="tsSaveRun" class="ghost">Save & re-direct</button><button id="tsCopy" class="ghost">Copy text</button></div>
  `, async el => {
    if (t.audioId) {
      const a = await store.getAudio(t.audioId);
      if (a?.blob) el.querySelector('#tsAudio').innerHTML = `<audio controls preload="metadata" style="width:100%;margin-top:10px" src="${URL.createObjectURL(a.blob)}"></audio>`;
    }
    const save = async () => { t.raw = el.querySelector('#tsRaw').value; await saveP(); };
    el.querySelector('#tsSave').onclick = async () => { await save(); closeSheet(); renderTakes(); toast('Saved.'); };
    el.querySelector('#tsSaveRun').onclick = async () => { await save(); closeSheet(); if (t.status === 'done') unmergeTake(P, t.id); enqueue([t.id]); };
    el.querySelector('#tsCopy').onclick = async () => { await navigator.clipboard?.writeText(t.raw); toast('Copied.'); };
  });
}

$('#btnProcessAll').onclick = () => {
  const ids = P.takes.filter(t => t.status !== 'done').map(t => t.id);
  if (!ids.length) return toast('Every take is already directed.');
  if (!S.apiKey) return settingsSheet();
  enqueue(ids);
};

$('#btnRebuild').onclick = async () => {
  if (!P.takes.length) return toast('No takes to rebuild from.');
  if (!S.apiKey) return settingsSheet();
  if (!confirm(`Re-sort all ${P.takes.length} takes from scratch? The draft, bible, and notes are rebuilt. Hand edits to the draft are lost (your takes are kept). Export first if you want a copy.`)) return;
  P.units = [];
  P.entities = P.entities.filter(e => e.summaryEdited);
  P.questions = [];
  P.takes.forEach(t => { t.status = 'new'; t.error = ''; });
  await saveP();
  enqueue(P.takes.map(t => t.id));
};

// ---------- director queue ----------
function enqueue(ids) {
  for (const id of ids) if (!queue.includes(id)) queue.push(id);
  renderTakes();
  if (!job) runQueue();
}

async function runQueue() {
  const project = P;
  const total = queue.length;
  let n = 0;
  $('#jobBar').hidden = false;
  while (queue.length) {
    const takeId = queue.shift();
    const take = project.takes.find(t => t.id === takeId);
    if (!take) continue;
    n++;
    const ctrl = new AbortController();
    job = { takeId, ctrl };
    const label = `Directing take ${n} of ${total}`;
    $('#jobText').textContent = label + '…';
    try {
      const out = await directTake({
        project, take, voice: V, settings: S, signal: ctrl.signal,
        onProgress: chars => { $('#jobText').textContent = `${label}… ${(chars / 1000).toFixed(1)}k characters placed`; },
      });
      const rep = mergeDirectorResult(project, out.result, take.id);
      Object.assign(take, { status: 'done', error: '', summary: out.result.take_summary || '', prepared: out.prepared, cues: out.cues, model: out.model });
      await store.saveProject(project);
      const bits = [];
      if (rep.newUnits) bits.push(`${rep.newUnits} new ${kindOf(project.kind).unit}${rep.newUnits > 1 ? 's' : ''}`);
      bits.push(`${rep.blocks} passages placed`);
      if (rep.newEntities) bits.push(`${rep.newEntities} new in the bible`);
      if (rep.flags) bits.push(`${rep.flags} note${rep.flags > 1 ? 's' : ''} for you`);
      toast(bits.join(' · '), 4000);
    } catch (err) {
      if (ctrl.signal.aborted) { take.status = take.status === 'done' ? 'done' : 'new'; break; }
      take.status = 'error';
      take.error = err.message;
      await store.saveProject(project);
      toast(err.message, 6000);
      if (/API key|access/i.test(err.message)) { queue.length = 0; break; }
    }
    if (P === project) rerender();
  }
  job = null;
  queue.length = 0;
  $('#jobBar').hidden = true;
  if (P === project && view === 'record') renderTakes();
}
$('#jobCancel').onclick = () => { queue.length = 0; job?.ctrl.abort(); };

// ---------- draft ----------
function spokenSet(p) {
  const texts = p.takes.map(t => t.raw);
  for (const u of p.units) for (const b of u.blocks) if (b.origin === 'you' || b.edited) texts.push(b.text);
  return trigramSet(texts);
}

function markLint(text) {
  const hits = lint(text, V).filter(x => x.match && x.type !== 'rhythm');
  if (!hits.length) return h(text);
  let out = '', i = 0;
  for (const x of hits) {
    if (x.index < i) continue;
    out += h(text.slice(i, x.index)) + `<mark class="g ${x.severity === 'low' ? 'low' : ''}" title="${h(x.message)}">${h(x.match)}</mark>`;
    i = x.index + x.match.length;
  }
  return out + h(text.slice(i));
}

function unitAuth(u, set) {
  let num = 0, den = 0;
  for (const b of u.blocks) {
    if (['note', 'tk', 'cite'].includes(b.type) || b.origin === 'you' || b.edited) continue;
    const a = authenticity(b.text, set);
    if (a == null) continue;
    const w = words(b.text);
    num += a * w; den += w;
  }
  return den ? num / den : null;
}

function renderDraft() {
  if (!P) return;
  const k = kindOf(P.kind);
  const guard = $('#showGuard').checked;
  const set = spokenSet(P);
  $('#draftTitle').textContent = k.unitPlural;
  const auth = (() => { let n = 0, d = 0; for (const u of P.units) { const a = unitAuth(u, set); if (a != null) { const w = u.blocks.reduce((s, b) => s + words(b.text), 0); n += a * w; d += w; } } return d ? n / d : null; })();
  $('#draftStats').textContent = `${P.units.length} ${k.unitPlural.toLowerCase()} · ${wordCount(P).toLocaleString()} words from ${spokenWordCount(P).toLocaleString()} spoken · your words ${pct(auth)}`;
  $('#logline').textContent = P.logline || '';
  const draft = $('#draft');
  draft.className = P.kind === 'screenplay' ? 'sp' : '';
  if (!P.units.length) {
    draft.innerHTML = `<div class="card"><p>Nothing here yet.</p><p class="muted small">Record a take and hit “Save & direct”. The Director will build ${k.unitPlural.toLowerCase()}, a bible, and a structure from what you say.</p><button class="primary" id="goRec">Start talking</button></div>`;
    $('#goRec').onclick = () => show('record');
    return;
  }
  let group = null;
  const html = [];
  for (const u of P.units) {
    if (u.group && u.group !== group) { html.push(`<h2 class="group-h">${h(u.group)}</h2>`); group = u.group; }
    const a = unitAuth(u, set);
    html.push(`<div class="unit" data-u="${u.id}">
      <div class="unit-h"><div class="t"><h3>${h(u.title)}</h3><div class="sum">${h(u.summary)}</div>
        <div class="meta muted small" style="margin-top:4px">${u.beat ? `<span class="pill">${h(u.beat)}</span>` : ''}<span class="pill auth ${a == null ? '' : a > 0.85 ? 'ok' : a > 0.6 ? 'warn' : 'bad'}">your words ${pct(a)}</span></div></div>
        <button class="ghost icon" data-umenu aria-label="Unit options">⋯</button></div>
      <div class="unit-body">${u.blocks.map(b => {
        const cls = ['blk', b.type, b.origin === 'bridge' ? 'bridge' : '', b.origin === 'you' ? 'you' : ''].join(' ');
        const who = b.type === 'dialogue' && b.speaker ? `<span class="who">${h(b.speaker)}</span>` : '';
        const body = b.type === 'tk' ? h(/^tk/i.test(b.text) ? b.text : 'TK: ' + b.text) : b.type === 'note' ? '✎ ' + h(b.text) : b.type === 'cite' ? '[cite] ' + h(b.text) : guard ? markLint(b.text) : h(b.text);
        return `<p class="${cls}" data-b="${b.id}">${who}${body}</p>`;
      }).join('') || '<p class="muted small">Empty. Tap ⋯ to add a passage.</p>'}</div></div>`);
  }
  draft.innerHTML = html.join('');
  draft.querySelectorAll('[data-b]').forEach(el => el.onclick = () => blockSheet(el.closest('[data-u]').dataset.u, el.dataset.b));
  draft.querySelectorAll('[data-umenu]').forEach(el => el.onclick = () => unitSheet(el.closest('[data-u]').dataset.u));
}
$('#showGuard').onchange = renderDraft;
$('#logline').addEventListener('blur', async () => {
  const v = $('#logline').textContent.trim();
  if (P && v !== P.logline) { P.logline = v; P.loglineEdited = true; await saveP(); }
});

function blockSheet(uId, bId) {
  const u = P.units.find(x => x.id === uId);
  const b = u.blocks.find(x => x.id === bId);
  const k = kindOf(P.kind);
  const types = [...new Set([...k.blocks, b.type])];
  const findings = lint(b.text, V);
  sheet('Passage', `
    <textarea id="bsText" rows="8" style="font-family:${P.kind === 'screenplay' ? 'var(--mono)' : 'var(--prose)'};font-size:17px">${h(b.text)}</textarea>
    ${findings.length ? `<div class="card small">${findings.map(f => `<div class="hit">⚠︎ ${h(f.message)}${f.match ? ` <q>${h(f.match)}</q>` : ''}</div>`).join('')}<button id="bsFix" class="ghost small mt">Auto-fix em dashes</button></div>` : ''}
    <div class="row gap">
      <div style="flex:1"><label>Type</label><select id="bsType">${types.map(t => `<option value="${t}" ${t === b.type ? 'selected' : ''}>${BLOCK_TYPES[t] || t}</option>`).join('')}</select></div>
      <div style="flex:1"><label>Speaker</label><input type="text" id="bsSpeaker" value="${h(b.speaker)}"></div>
    </div>
    <label>Move to</label><select id="bsUnit">${P.units.map(x => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${h((x.group ? x.group + ' / ' : '') + x.title)}</option>`).join('')}</select>
    <p class="muted small">${b.origin === 'bridge' ? 'The Director added these words to connect passages. Edit them and they become yours.' : b.origin === 'you' ? 'You wrote this by hand.' : 'From your take' + (b.edited ? ', edited by you.' : '.')}</p>
    <div class="row gap wrap"><button id="bsSave" class="primary">Save</button><button id="bsUp" class="ghost small">↑</button><button id="bsDown" class="ghost small">↓</button><button id="bsAdd" class="ghost small">+ Below</button><button id="bsDel" class="ghost small danger">Delete</button></div>
  `, el => {
    const ta = el.querySelector('#bsText');
    el.querySelector('#bsFix')?.addEventListener('click', () => { ta.value = autofix(ta.value); });
    el.querySelector('#bsSave').onclick = async () => {
      const text = ta.value.trim();
      if (text !== b.text) { b.text = text; b.edited = true; if (b.origin === 'bridge') b.origin = 'you'; }
      b.type = el.querySelector('#bsType').value;
      b.speaker = el.querySelector('#bsSpeaker').value.trim();
      const dest = el.querySelector('#bsUnit').value;
      if (dest !== u.id) {
        u.blocks = u.blocks.filter(x => x !== b);
        P.units.find(x => x.id === dest).blocks.push(b);
      }
      await saveP(); closeSheet(); renderDraft();
    };
    const move = async d => {
      const i = u.blocks.indexOf(b), j = i + d;
      if (j < 0 || j >= u.blocks.length) return;
      [u.blocks[i], u.blocks[j]] = [u.blocks[j], u.blocks[i]];
      await saveP(); renderDraft();
    };
    el.querySelector('#bsUp').onclick = () => move(-1);
    el.querySelector('#bsDown').onclick = () => move(1);
    el.querySelector('#bsAdd').onclick = async () => {
      const nb = { id: uid('b_'), type: P.kind === 'screenplay' ? 'action' : 'para', text: '…', speaker: '', origin: 'you' };
      u.blocks.splice(u.blocks.indexOf(b) + 1, 0, nb);
      await saveP(); renderDraft(); blockSheet(u.id, nb.id);
    };
    el.querySelector('#bsDel').onclick = async () => {
      u.blocks = u.blocks.filter(x => x !== b);
      await saveP(); closeSheet(); renderDraft();
    };
  });
}

function unitSheet(uId) {
  const u = P.units.find(x => x.id === uId);
  const k = kindOf(P.kind);
  const i = P.units.indexOf(u);
  sheet(k.unit[0].toUpperCase() + k.unit.slice(1), `
    <label>Working title</label><input type="text" id="usTitle" value="${h(u.title)}">
    <label>${P.kind === 'screenplay' ? 'Act / sequence' : 'Chapter / part'}</label><input type="text" id="usGroup" value="${h(u.group)}" list="groups">
    <datalist id="groups">${[...new Set(P.units.map(x => x.group).filter(Boolean))].map(g => `<option value="${h(g)}">`).join('')}</datalist>
    <label>Summary</label><textarea id="usSum" rows="2">${h(u.summary)}</textarea>
    <label>Beat</label><select id="usBeat"><option value="">(none)</option>${k.arc.map(b => `<option ${b === u.beat ? 'selected' : ''}>${h(b)}</option>`).join('')}</select>
    <div class="row gap wrap mt"><button id="usSave" class="primary">Save</button><button id="usUp" class="ghost small" ${i === 0 ? 'disabled' : ''}>Move up</button><button id="usDown" class="ghost small" ${i === P.units.length - 1 ? 'disabled' : ''}>Move down</button></div>
    <div class="row gap wrap mt"><button id="usAdd" class="ghost small">+ Add passage</button><button id="usMerge" class="ghost small" ${i === 0 ? 'disabled' : ''}>Merge into previous</button><button id="usDel" class="ghost small danger">Delete</button></div>
  `, el => {
    el.querySelector('#usSave').onclick = async () => {
      u.title = el.querySelector('#usTitle').value.trim() || u.title;
      u.group = el.querySelector('#usGroup').value.trim();
      const sum = el.querySelector('#usSum').value.trim();
      if (sum !== u.summary) { u.summary = sum; u.summaryEdited = true; }
      u.beat = el.querySelector('#usBeat').value;
      await saveP(); closeSheet(); rerender();
    };
    const move = async d => { const j = i + d; [P.units[i], P.units[j]] = [P.units[j], P.units[i]]; await saveP(); closeSheet(); rerender(); };
    el.querySelector('#usUp').onclick = () => move(-1);
    el.querySelector('#usDown').onclick = () => move(1);
    el.querySelector('#usAdd').onclick = async () => {
      const nb = { id: uid('b_'), type: P.kind === 'screenplay' ? 'action' : 'para', text: '…', speaker: '', origin: 'you' };
      u.blocks.push(nb);
      await saveP(); renderDraft(); blockSheet(u.id, nb.id);
    };
    el.querySelector('#usMerge').onclick = async () => {
      const prev = P.units[i - 1];
      prev.blocks.push(...u.blocks);
      prev.takeIds = [...new Set([...(prev.takeIds || []), ...(u.takeIds || [])])];
      P.units.splice(i, 1);
      await saveP(); closeSheet(); rerender();
    };
    el.querySelector('#usDel').onclick = async () => {
      if (u.blocks.length && !confirm(`Delete “${u.title}” and its ${u.blocks.length} passages? Your takes stay.`)) return;
      P.units.splice(i, 1);
      await saveP(); closeSheet(); rerender();
    };
  });
}

$('#btnAddUnit').onclick = async () => {
  const k = kindOf(P.kind);
  const u = { id: uid('u_'), type: k.unit, title: `New ${k.unit}`, group: P.units.at(-1)?.group || '', beat: '', summary: '', blocks: [], takeIds: [], locked: true };
  P.units.push(u);
  await saveP();
  renderDraft();
  unitSheet(u.id);
};

// ---------- bible ----------
function renderBible() {
  if (!P) return;
  const k = kindOf(P.kind);
  const q = $('#bibleSearch').value.trim().toLowerCase();
  const match = e => !q || [e.name, e.summary, ...(e.aliases || []), ...(e.details || [])].join(' ').toLowerCase().includes(q);
  const groups = Object.entries(k.entities).map(([type, label]) => {
    const list = P.entities.filter(e => e.type === type && match(e));
    return `<div class="ent-group"><div class="row between"><h3>${h(label)} <span class="muted">(${list.length})</span></h3><button class="ghost small" data-add="${type}">+ Add</button></div>
      <div class="list">${list.map(e => `<div class="item ent" data-e="${e.id}"><h4>${h(e.name)}</h4>${e.aliases?.length ? `<div class="aka">aka ${h(e.aliases.join(', '))}</div>` : ''}${e.summary ? `<p>${h(e.summary)}</p>` : ''}${e.details?.length ? `<ul>${e.details.map(d => `<li>${h(d)}</li>`).join('')}</ul>` : ''}</div>`).join('') || '<p class="muted small">Nothing yet.</p>'}</div></div>`;
  });
  const stray = P.entities.filter(e => !k.entities[e.type] && match(e));
  if (stray.length) groups.push(`<div class="ent-group"><h3>Other</h3><div class="list">${stray.map(e => `<div class="item ent" data-e="${e.id}"><h4>${h(e.name)}</h4><p>${h(e.summary)}</p></div>`).join('')}</div></div>`);
  $('#bible').innerHTML = groups.join('');
  $$('#bible [data-e]').forEach(el => el.onclick = () => entitySheet(el.dataset.e));
  $$('#bible [data-add]').forEach(el => el.onclick = async () => {
    const e = { id: uid('e_'), type: el.dataset.add, name: 'New', aliases: [], summary: '', details: [], takeIds: [], summaryEdited: true };
    P.entities.push(e);
    await saveP();
    entitySheet(e.id);
  });
}
$('#bibleSearch').oninput = renderBible;

function entitySheet(id) {
  const e = P.entities.find(x => x.id === id);
  const k = kindOf(P.kind);
  const others = P.entities.filter(x => x !== e);
  const appears = P.units.filter(u => u.blocks.some(b => [e.name, ...(e.aliases || [])].some(n => n && (b.text + ' ' + b.speaker).toLowerCase().includes(n.toLowerCase()))));
  sheet(k.entities[e.type] || 'Entry', `
    <label>Name</label><input type="text" id="esName" value="${h(e.name)}">
    <label>Also called (comma separated)</label><input type="text" id="esAka" value="${h((e.aliases || []).join(', '))}">
    <label>Type</label><select id="esType">${Object.entries(k.entities).map(([t, l]) => `<option value="${t}" ${t === e.type ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
    <label>Summary</label><textarea id="esSum" rows="3">${h(e.summary)}</textarea>
    <label>Details (one per line)</label><textarea id="esDet" rows="6">${h((e.details || []).join('\n'))}</textarea>
    ${appears.length ? `<p class="muted small">Shows up in: ${appears.map(u => h(u.title)).join(', ')}</p>` : ''}
    <div class="row gap wrap mt"><button id="esSave" class="primary">Save</button><button id="esDel" class="ghost danger small">Delete</button></div>
    ${others.length ? `<label>Same as another entry? Merge into</label><div class="row gap"><select id="esMergeTo">${others.map(o => `<option value="${o.id}">${h(o.name)}</option>`).join('')}</select><button id="esMerge" class="ghost small">Merge</button></div>` : ''}
  `, el => {
    el.querySelector('#esSave').onclick = async () => {
      e.name = el.querySelector('#esName').value.trim() || e.name;
      e.aliases = el.querySelector('#esAka').value.split(',').map(s => s.trim()).filter(Boolean);
      e.type = el.querySelector('#esType').value;
      const sum = el.querySelector('#esSum').value.trim();
      if (sum !== e.summary) { e.summary = sum; e.summaryEdited = true; }
      e.details = el.querySelector('#esDet').value.split('\n').map(s => s.trim()).filter(Boolean);
      await saveP(); closeSheet(); renderBible();
    };
    el.querySelector('#esDel').onclick = async () => { P.entities = P.entities.filter(x => x !== e); await saveP(); closeSheet(); renderBible(); };
    el.querySelector('#esMerge')?.addEventListener('click', async () => {
      const to = P.entities.find(x => x.id === el.querySelector('#esMergeTo').value);
      to.aliases = [...new Set([...(to.aliases || []), e.name, ...(e.aliases || [])])].filter(a => a.toLowerCase() !== to.name.toLowerCase());
      to.details = [...new Set([...(to.details || []), ...(e.details || [])])];
      to.takeIds = [...new Set([...(to.takeIds || []), ...(e.takeIds || [])])];
      if (!to.summary) to.summary = e.summary;
      P.entities = P.entities.filter(x => x !== e);
      await saveP(); closeSheet(); renderBible(); toast(`Merged into ${to.name}.`);
    });
  });
}

// ---------- arc ----------
function renderArc() {
  if (!P) return;
  const k = kindOf(P.kind);
  const chip = u => `<span class="chip" data-u="${u.id}">${h(u.title)}</span>`;
  const rows = k.arc.map(b => {
    const us = P.units.filter(u => u.beat === b);
    return `<div class="beat ${us.length ? 'filled' : ''}"><h4>${h(b)}</h4>${us.map(chip).join('') || '<span class="muted small">nothing yet</span>'}</div>`;
  });
  const loose = P.units.filter(u => !u.beat);
  if (loose.length) rows.push(`<div class="beat"><h4 class="muted">Not placed yet</h4>${loose.map(chip).join('')}</div>`);
  $('#arc').innerHTML = rows.join('');
  $$('#arc .chip').forEach(el => el.onclick = () => unitSheet(el.dataset.u));

  const qs = [...P.questions].sort((a, b) => a.resolved - b.resolved || b.created - a.created);
  const icon = { question: '❓', continuity: '⚠︎', missing: '🕳', idea: '💡' };
  $('#questions').innerHTML = qs.map(q => `<label class="item q ${q.resolved ? 'resolved' : ''}"><input type="checkbox" data-q="${q.id}" ${q.resolved ? 'checked' : ''}><span>${icon[q.kind] || '•'} ${h(q.text)}</span></label>`).join('') || '<p class="muted small">The Director’s questions, continuity catches, and ideas land here.</p>';
  $$('#questions [data-q]').forEach(el => el.onchange = async () => { P.questions.find(q => q.id === el.dataset.q).resolved = el.checked; await saveP(); renderArc(); });

  const asks = P.asks || [];
  $('#askAnswer').hidden = !asks.length;
  if (asks.length) $('#askAnswer').innerHTML = asks.slice(-5).reverse().map(a => `<p class="muted small" style="margin:0">${fmtDate(a.at)} · ${h(a.q)}</p><div style="margin:4px 0 16px">${h(a.a)}</div>`).join('');
}

$('#btnAsk').onclick = async () => {
  const q = $('#askText').value.trim();
  if (!q) return;
  if (!S.apiKey) return settingsSheet();
  const btn = $('#btnAsk');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const a = await askDirector({ project: P, voice: V, settings: S, question: q, onProgress: n => { btn.textContent = `Writing… ${n}`; } });
    (P.asks ||= []).push({ q, a, at: Date.now() });
    await saveP();
    $('#askText').value = '';
    renderArc();
  } catch (err) { toast(err.message, 5000); }
  btn.disabled = false;
  btn.textContent = 'Ask';
};

let askDict = null;
$('#btnAskVoice').onclick = async () => {
  if (askDict?.active) { const r = await askDict.stop(); $('#askText').value = r.text; $('#btnAskVoice').textContent = '🎙'; return; }
  askDict = new Dictation({ lang: S.lang, onText: t => { $('#askText').value = t; }, onError: m => toast(m, 4000) });
  try { await askDict.start(); $('#btnAskVoice').textContent = '■'; } catch (err) { toast(err.message, 4000); }
};

// ---------- voice ----------
function renderVoice() {
  if (P) {
    const set = spokenSet(P);
    const counts = {};
    const hits = [];
    let bridgeWords = 0, total = 0;
    for (const u of P.units) for (const b of u.blocks) {
      if (['note', 'tk', 'cite'].includes(b.type)) continue;
      total += words(b.text);
      if (b.origin === 'bridge') bridgeWords += words(b.text);
      for (const f of lint(b.text, V)) { counts[f.type] = (counts[f.type] || 0) + 1; if (hits.length < 40 && f.severity !== 'low') hits.push({ f, u, b }); }
    }
    let n = 0, d = 0;
    for (const u of P.units) { const a = unitAuth(u, set); if (a != null) { const w = u.blocks.reduce((s, b) => s + words(b.text), 0); n += a * w; d += w; } }
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $('#guardSummary').innerHTML = [
      stat(pct(d ? n / d : null), 'of the draft is your spoken words'),
      stat(total ? (bridgeWords / total * 100).toFixed(1) + '%' : '–', 'added by the Director (blue)'),
      stat(counts.emdash || 0, 'em dashes'),
      stat((counts.word || 0) + (counts.phrase || 0), 'banned words & phrases'),
      stat(counts.negpar || 0, 'negative parallelisms'),
      stat(counts.triad || 0, 'lists of exactly 3'),
    ].join('');
    $('#guardList').innerHTML = hits.map(({ f, u, b }) => `<div class="item hit" data-u="${u.id}" data-b="${b.id}">⚠︎ ${h(f.message)} ${f.match ? `<q>${h(f.match)}</q>` : ''} <span class="muted small">in ${h(u.title)}</span></div>`).join('') || (P.units.length ? '<p class="muted small">Clean. Nothing in the draft trips the guard.</p>' : '');
    $$('#guardList [data-b]').forEach(el => el.onclick = () => blockSheet(el.dataset.u, el.dataset.b));
  }
  $('#fingerprint').textContent = V.fingerprint ? describeFingerprint(V.fingerprint) : 'Add at least a few hundred words of your writing to build a fingerprint.';
  $('#samples').innerHTML = V.samples.map(s => `<div class="item" data-s="${s.id}"><div class="row between"><b>${h(s.title)}</b><button class="ghost small danger" data-del>Remove</button></div><div class="muted small">${words(s.text).toLocaleString()} words</div></div>`).join('');
  $$('#samples [data-del]').forEach(el => el.onclick = async () => {
    V.samples = V.samples.filter(s => s.id !== el.closest('[data-s]').dataset.s);
    V.fingerprint = fingerprint(V.samples);
    await store.saveVoice(V);
    renderVoice();
  });
  $('#voiceRules').value = V.rules.join('\n');
  $('#voiceWords').value = V.bannedWords.join(', ');
  $('#voicePhrases').value = V.bannedPhrases.join(', ');
}

async function addSample(title, text) {
  if (!text.trim()) return;
  V.samples.push({ id: uid('s_'), title: title || 'Sample', text });
  V.fingerprint = fingerprint(V.samples);
  await store.saveVoice(V);
  renderVoice();
  toast('Sample added. Fingerprint updated.');
}

$('#btnAddSample').onclick = () => sheet('Writing sample', `
  <label>Title</label><input type="text" id="ssTitle" placeholder="e.g. Substack: The Fire Season">
  <label>Paste your writing</label><textarea id="ssText" rows="12"></textarea>
  <button id="ssSave" class="primary mt">Add sample</button>
`, el => { el.querySelector('#ssSave').onclick = async () => { await addSample(el.querySelector('#ssTitle').value.trim(), el.querySelector('#ssText').value); closeSheet(); }; });

function pickTextFiles(cb) {
  const input = $('#sampleFile');
  input.value = '';
  input.onchange = async () => {
    const out = [];
    for (const f of input.files) {
      let t = await f.text();
      if (/\.rtf$/i.test(f.name)) t = t.replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, '');
      out.push(t);
      out.names = [...(out.names || []), f.name];
    }
    cb(out);
  };
  input.click();
}
$('#btnUploadSample').onclick = () => pickTextFiles(async texts => { for (let i = 0; i < texts.length; i++) await addSample(texts.names[i], texts[i]); });

$('#btnSaveVoice').onclick = async () => {
  V.rules = $('#voiceRules').value.split('\n').map(s => s.trim()).filter(Boolean);
  V.bannedWords = $('#voiceWords').value.split(',').map(s => s.trim()).filter(Boolean);
  V.bannedPhrases = $('#voicePhrases').value.split(',').map(s => s.trim()).filter(Boolean);
  await store.saveVoice(V);
  toast('Rules saved. The Director uses them from the next take.');
  renderVoice();
};
$('#btnResetVoice').onclick = async () => {
  if (!confirm('Reset rules and banned lists to the defaults? Samples stay.')) return;
  const d = defaultVoice();
  Object.assign(V, { rules: d.rules, bannedWords: d.bannedWords, bannedPhrases: d.bannedPhrases });
  await store.saveVoice(V);
  renderVoice();
};
$('#btnFixDashes').onclick = async () => {
  let n = 0;
  for (const u of P.units) for (const b of u.blocks) { const f = autofix(b.text); if (f !== b.text) { b.text = f; n++; } }
  await saveP();
  toast(n ? `Fixed ${n} passage${n > 1 ? 's' : ''}.` : 'No em dashes found.');
  renderVoice();
};

// ---------- export ----------
function renderExport() {
  if (!P) return;
  const k = kindOf(P.kind);
  $('#optTitles').checked = exportOpts.includeTitles;
  $('#optNotes').checked = exportOpts.includeNotes;
  $('#optBridges').checked = exportOpts.markBridges;
  $('#optBible').checked = exportOpts.includeBible;
  const row = id => `<div class="item fmt" data-f="${id}"><div class="t"><b>${h(FORMATS[id].label)}</b><span>${h(FORMATS[id].note)}</span></div><span>↗</span></div>`;
  $('#formats').innerHTML = k.exports.map(row).join('');
  $('#formatsMore').innerHTML = Object.keys(FORMATS).filter(f => !k.exports.includes(f)).map(row).join('');
  $$('[data-f]').forEach(el => el.onclick = () => doExport(el.dataset.f));
}
[['#optTitles', 'includeTitles'], ['#optNotes', 'includeNotes'], ['#optBridges', 'markBridges'], ['#optBible', 'includeBible']]
  .forEach(([sel, key]) => { $(sel).onchange = () => { exportOpts[key] = $(sel).checked; }; });

async function shareFile(name, mime, data) {
  const file = new File([data], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function doExport(fmt) {
  if (!P.units.length && fmt !== 'json') return toast('Nothing to export yet. Direct a take first.');
  if (FORMATS[fmt].print) {
    $('#printArea').innerHTML = printHtml(P, exportOpts);
    window.print();
    return;
  }
  try {
    const f = exportFile(P, fmt, exportOpts);
    await shareFile(f.name, f.mime, f.data);
  } catch (err) { toast('Export failed: ' + err.message, 5000); }
}

$('#btnBackupAll').onclick = async () => {
  const data = await store.backupAll();
  await shareFile(`voice-director-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(data));
};
$('#btnRestore').onclick = () => $('#restoreFile').click();
$('#restoreFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const n = await store.restoreBackup(JSON.parse(await f.text()));
    V = await store.loadVoice();
    toast(`Restored ${n} project${n > 1 ? 's' : ''}.`);
    renderHome();
  } catch (err) { toast('Could not restore: ' + err.message, 5000); }
  e.target.value = '';
};

// ---------- settings ----------
async function settingsSheet() {
  const est = await store.storageEstimate();
  sheet('Settings', `
    <label>Anthropic API key</label>
    <div class="row gap"><input type="password" id="stKey" value="${h(S.apiKey)}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="stShow" class="ghost small">Show</button></div>
    <p class="muted small">Get one at console.anthropic.com → API Keys. It stays on this phone and is only sent to Anthropic.</p>
    <button id="stTest" class="ghost small">Test key</button>
    <label>Model</label><select id="stModel">${Object.entries(MODELS).map(([id, l]) => `<option value="${id}" ${id === S.model ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
    <label>Effort (how hard the Director thinks)</label><select id="stEffort">${['low', 'medium', 'high', 'xhigh', 'max'].map(e => `<option ${e === S.effort ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <label>Dictation language</label><select id="stLang">${['en-US', 'en-GB', 'en-AU', 'en-CA', 'es-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR'].map(l => `<option ${l === S.lang ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="toggle"><input type="checkbox" id="stAudio" ${S.keepAudio ? 'checked' : ''}> Keep an audio copy of each take (some iPhones can’t record and dictate at once; if so this turns itself off)</label>
    <label class="toggle"><input type="checkbox" id="stFallback" ${S.fallbacks ? 'checked' : ''}> If Claude declines a take, retry on a fallback model automatically</label>
    <label>Your name (title pages)</label><input type="text" id="stAuthor" value="${h(S.author)}">
    <button id="stSave" class="primary wide mt">Save settings</button>
    <p class="muted small mt">Storage used: ${est ? (est.usage / 1e6).toFixed(1) + ' MB' : 'unknown'}. Add this app to your Home Screen so iOS keeps your projects. Back up from the home screen now and then.</p>
  `, el => {
    el.querySelector('#stShow').onclick = () => { const i = el.querySelector('#stKey'); i.type = i.type === 'password' ? 'text' : 'password'; };
    const read = () => ({
      ...S,
      apiKey: el.querySelector('#stKey').value.trim(),
      model: el.querySelector('#stModel').value,
      effort: el.querySelector('#stEffort').value,
      lang: el.querySelector('#stLang').value,
      keepAudio: el.querySelector('#stAudio').checked,
      fallbacks: el.querySelector('#stFallback').checked,
      author: el.querySelector('#stAuthor').value.trim(),
    });
    el.querySelector('#stTest').onclick = async () => {
      const b = el.querySelector('#stTest');
      b.textContent = 'Testing…';
      try { await pingClaude(read()); toast('Key works.'); } catch (err) { toast(err.message, 5000); }
      b.textContent = 'Test key';
    };
    el.querySelector('#stSave').onclick = () => { S = read(); store.saveSettings(S); closeSheet(); toast('Saved.'); };
  });
}
$('#btnSettings').onclick = settingsSheet;

// ---------- boot ----------
async function boot() {
  V = await store.loadVoice();
  store.requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const d = await store.loadDraftTake();
  if (S.lastProject) P = await store.getProject(S.lastProject) || null;
  if (P) {
    show(P.takes.length ? 'draft' : 'record');
    if (d?.projectId === P.id && d.text?.trim()) {
      $('#takeText').value = d.text;
      pending.seconds = d.seconds || 0;
      show('record');
      toast('Recovered your unsaved take.');
    }
  } else show('home');
  setMode(speechSupported() ? 'live' : 'type');
}
boot();

// Expose for debugging in Safari's Web Inspector.
window.VD = { get project() { return P; }, get settings() { return S; }, get voice() { return V; } };
