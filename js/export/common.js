// Shared pieces for every exporter.

import { kindOf } from '../kinds.js';

export const DEFAULT_EXPORT_OPTS = {
  includeTitles: true,   // working titles of scenes/sections
  includeNotes: true,    // notes to self, TKs, citation flags
  markBridges: true,     // highlight words the Director added
  includeBible: false,   // append the bible after the draft
};

export const slug = s => String(s || 'untitled').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'untitled';
export const fileSafe = s => String(s || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0 forbids most control characters.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export const isNoteish = b => ['note', 'tk', 'cite'].includes(b.type);

export function noteText(b) {
  if (b.type === 'tk') return /^tk\b/i.test(b.text) ? b.text : `TK: ${b.text}`;
  if (b.type === 'cite') return /^\[?cite/i.test(b.text) ? b.text.replace(/^\[|\]$/g, '') : `CITE: ${b.text}`;
  return `NOTE: ${b.text}`;
}

export function proseDialogue(b) {
  const t = String(b.text || '').trim();
  return /^["“]/.test(t) ? t : `“${t}”`;
}

/**
 * Flatten a project into an ordered list of document items.
 * Items: {t:'group', text} | {t:'unit', unit} | {t:'block', block, unit} | {t:'break'}
 */
export function flatten(project, opts = DEFAULT_EXPORT_OPTS) {
  const items = [];
  let group = null;
  let first = true;
  for (const u of project.units) {
    if (u.group && u.group !== group) {
      items.push({ t: 'group', text: u.group });
      group = u.group;
      first = true;
    } else if (!first && !opts.includeTitles && project.kind === 'novel') {
      items.push({ t: 'break' });
    }
    if (opts.includeTitles) items.push({ t: 'unit', unit: u });
    for (const b of u.blocks) {
      if (isNoteish(b) && !opts.includeNotes) continue;
      items.push({ t: 'block', block: b, unit: u });
    }
    first = false;
  }
  return items;
}

export function bibleSections(project) {
  const k = kindOf(project.kind);
  return Object.entries(k.entities).map(([type, label]) => ({
    type, label, entities: project.entities.filter(e => e.type === type),
  })).filter(s => s.entities.length);
}

export function bibleMarkdown(project) {
  const out = [];
  for (const s of bibleSections(project)) {
    out.push(`## ${s.label}`, '');
    for (const e of s.entities) {
      out.push(`### ${e.name}${e.aliases?.length ? ` (${e.aliases.join(', ')})` : ''}`);
      if (e.summary) out.push(e.summary);
      for (const d of e.details || []) out.push(`- ${d}`);
      out.push('');
    }
  }
  return out.join('\n');
}

export function questionsList(project) {
  return project.questions.filter(q => !q.resolved).map(q => `[${q.kind}] ${q.text}`);
}

export const today = () => new Date().toISOString().slice(0, 10);
