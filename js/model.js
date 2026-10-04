// Project data model and the merge that folds a Director pass into it.
// The Director only ever adds. It never deletes or rewrites what you've edited by hand.

import { kindOf } from './kinds.js';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function newProject({ title, kind, author = '', editLevel = 'clean' }) {
  const now = Date.now();
  return {
    id: uid('p_'),
    title: title || 'Untitled',
    kind,
    author,
    editLevel,
    created: now,
    updated: now,
    logline: '',
    takes: [],
    units: [],
    entities: [],
    questions: [],
  };
}

export function newTake(raw, extra = {}) {
  return { id: uid('t_'), created: Date.now(), raw: raw || '', prepared: '', cues: [], durationSec: 0, audioId: null, status: 'new', summary: '', error: '', ...extra };
}

const lc = s => String(s || '').trim().toLowerCase();

export function findEntity(project, type, name) {
  const n = lc(name);
  if (!n) return null;
  return project.entities.find(e => e.type === type && (lc(e.name) === n || (e.aliases || []).some(a => lc(a) === n)))
    || project.entities.find(e => lc(e.name) === n);
}

/** Merge a Director result into a project. Mutates and returns a change report. */
export function mergeDirectorResult(project, result, takeId) {
  const report = { newUnits: 0, blocks: 0, newEntities: 0, updatedEntities: 0, flags: 0 };
  const kind = kindOf(project.kind);
  const byId = new Map(project.units.map(u => [u.id, u]));
  let lastTouched = null;

  for (const pl of result.placements || []) {
    let unit = pl.target && pl.target !== 'NEW' ? byId.get(pl.target) : null;
    if (!unit) {
      unit = {
        id: uid('u_'),
        type: pl.unit_type || kind.unit,
        title: pl.title || `Untitled ${kind.unit}`,
        group: pl.group || '',
        beat: kind.arc.includes(pl.beat) ? pl.beat : '',
        summary: pl.summary || '',
        blocks: [],
        takeIds: [],
        locked: false,
      };
      // New units go after the last unit this take touched, else at the end.
      const at = lastTouched ? project.units.indexOf(lastTouched) + 1 : project.units.length;
      project.units.splice(at, 0, unit);
      byId.set(unit.id, unit);
      report.newUnits++;
    } else {
      if (pl.summary && !unit.summaryEdited) unit.summary = pl.summary;
      if (!unit.beat && kind.arc.includes(pl.beat)) unit.beat = pl.beat;
      if (!unit.group && pl.group) unit.group = pl.group;
    }
    for (const b of pl.blocks || []) {
      const text = String(b.text || '').trim();
      if (!text) continue;
      unit.blocks.push({ id: uid('b_'), type: b.type || 'para', text, speaker: b.speaker || '', origin: b.origin === 'bridge' ? 'bridge' : 'spoken', takeId });
      report.blocks++;
    }
    if (takeId && !unit.takeIds.includes(takeId)) unit.takeIds.push(takeId);
    lastTouched = unit;
  }

  for (const e of result.entities || []) {
    if (!e.name) continue;
    const type = kind.entities[e.type] ? e.type : Object.keys(kind.entities)[0];
    let ent = (e.ref && project.entities.find(x => x.id === e.ref)) || findEntity(project, type, e.name);
    if (!ent) {
      ent = { id: uid('e_'), type, name: e.name.trim(), aliases: [], summary: e.summary || '', details: [], takeIds: [], summaryEdited: false };
      project.entities.push(ent);
      report.newEntities++;
    } else {
      report.updatedEntities++;
      if (e.summary && !ent.summaryEdited) ent.summary = e.summary;
    }
    for (const a of e.aliases || []) {
      if (a && lc(a) !== lc(ent.name) && !ent.aliases.some(x => lc(x) === lc(a))) ent.aliases.push(a.trim());
    }
    for (const d of e.details || []) {
      if (d && !ent.details.some(x => lc(x) === lc(d))) ent.details.push(d.trim());
    }
    if (takeId && !ent.takeIds.includes(takeId)) ent.takeIds.push(takeId);
  }

  for (const f of result.flags || []) {
    if (!f.text) continue;
    project.questions.push({ id: uid('q_'), kind: f.kind || 'question', text: f.text, takeId, resolved: false, created: Date.now() });
    report.flags++;
  }

  if (result.logline && !project.loglineEdited) project.logline = result.logline;
  project.updated = Date.now();
  return report;
}

/** Remove everything a take contributed, so it can be re-run cleanly. Hand-edited blocks stay. */
export function unmergeTake(project, takeId) {
  for (const u of project.units) {
    u.blocks = u.blocks.filter(b => b.takeId !== takeId || b.origin === 'you');
    u.takeIds = (u.takeIds || []).filter(t => t !== takeId);
  }
  project.units = project.units.filter(u => u.blocks.length || u.takeIds.length || u.locked);
  for (const e of project.entities) e.takeIds = (e.takeIds || []).filter(t => t !== takeId);
  project.entities = project.entities.filter(e => e.takeIds.length || e.summaryEdited);
  project.questions = project.questions.filter(q => q.takeId !== takeId);
}

export function wordCount(project) {
  let n = 0;
  for (const u of project.units) for (const b of u.blocks) if (!['note', 'tk', 'cite'].includes(b.type)) n += (b.text.match(/\S+/g) || []).length;
  return n;
}

export function spokenWordCount(project) {
  return project.takes.reduce((n, t) => n + ((t.raw || '').match(/\S+/g) || []).length, 0);
}
