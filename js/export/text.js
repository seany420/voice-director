// Text-family exports: Markdown, Obsidian vault, plain text, RTF, OPML, Scrivener bundle, JSON.

import { zip } from './zip.js';
import { kindOf } from '../kinds.js';
import { buildFountain } from './screenplay.js';
import {
  xml, flatten, isNoteish, noteText, proseDialogue, bibleSections, bibleMarkdown, questionsList,
  fileSafe, pad, today, DEFAULT_EXPORT_OPTS,
} from './common.js';

// ---------- Markdown ----------

function blockMd(b, kind, opts) {
  if (isNoteish(b)) return b.type === 'tk' ? `==${noteText(b)}==` : `> [!note] ${noteText(b)}`;
  const t = opts.markBridges && b.origin === 'bridge' ? `<span class="bridge">${b.text}</span>` : b.text;
  if (kind === 'screenplay') {
    if (b.type === 'slug') return `**${t.toUpperCase()}**`;
    if (b.type === 'character') return `**${t.toUpperCase()}**`;
    if (b.type === 'paren') return `*${t}*`;
    if (b.type === 'dialogue') return (b.speaker ? `**${b.speaker.toUpperCase()}**\n` : '') + `> ${t}`;
    if (b.type === 'transition') return `*${t.toUpperCase()}*`;
    return t;
  }
  if (b.type === 'heading') return `### ${t}`;
  if (b.type === 'quote') return `> ${t}`;
  if (b.type === 'bullet') return `- ${t.replace(/^[•\-*]\s*/, '')}`;
  if (b.type === 'dialogue') return proseDialogue({ text: t });
  return t;
}

export function buildMarkdown(project, opts = DEFAULT_EXPORT_OPTS, { frontmatter = true } = {}) {
  const out = [];
  if (frontmatter) {
    out.push('---', `title: "${project.title.replace(/"/g, '\\"')}"`, `type: ${project.kind}`);
    if (project.author) out.push(`author: "${project.author}"`);
    out.push(`created: ${new Date(project.created).toISOString().slice(0, 10)}`, `updated: ${today()}`, `tags: [voice-director, ${project.kind}]`, '---', '');
  }
  out.push(`# ${project.title}`, '');
  if (project.logline) out.push(`*${project.logline}*`, '');
  for (const it of flatten(project, opts)) {
    if (it.t === 'group') out.push(`## ${it.text}`, '');
    else if (it.t === 'unit') out.push(`${project.units.some(u => u.group) ? '###' : '##'} ${it.unit.title}`, '');
    else if (it.t === 'break') out.push('#', '');
    else out.push(blockMd(it.block, project.kind, opts), '');
  }
  if (opts.includeBible && project.entities.length) out.push('---', '', '# Bible', '', bibleMarkdown(project));
  const qs = questionsList(project);
  if (opts.includeBible && qs.length) out.push('', `## Open questions`, '', ...qs.map(q => `- [ ] ${q}`));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- Plain text (also Scrivener "Import and Split" friendly) ----------

export function buildText(project, opts = DEFAULT_EXPORT_OPTS) {
  if (project.kind === 'screenplay') return buildFountain(project, opts);
  const out = [project.title.toUpperCase(), project.author ? `by ${project.author}` : '', ''];
  for (const it of flatten(project, opts)) {
    if (it.t === 'group') out.push('', `${it.text.toUpperCase()}`, '');
    else if (it.t === 'unit') out.push('', '#', it.unit.title, '');
    else if (it.t === 'break') out.push('', '#', '');
    else {
      const b = it.block;
      if (isNoteish(b)) out.push(`[${noteText(b)}]`, '');
      else if (b.type === 'dialogue') out.push(proseDialogue(b), '');
      else if (b.type === 'bullet') out.push(`- ${b.text}`, '');
      else out.push(b.text, '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- RTF ----------

export function rtfEscape(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (c < 128) out += ch;
    else if (c < 0x10000) out += `\\u${c > 32767 ? c - 65536 : c}?`;
    else {
      const v = c - 0x10000;
      const hi = 0xD800 + (v >> 10), lo = 0xDC00 + (v & 0x3FF);
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return out;
}

function rtfBlocks(blocks, kind, opts) {
  const P = (body, fmt = '') => `{\\pard\\plain\\f0\\fs24${fmt} ${body}\\par}\n`;
  const out = [];
  for (const b of blocks) {
    const bridge = opts.markBridges && b.origin === 'bridge' ? '\\cf2\\ul ' : '';
    if (isNoteish(b)) { out.push(P(`{\\i\\cf3 ${rtfEscape(noteText(b))}}`, '\\sa120')); continue; }
    if (kind === 'screenplay') {
      const f = { slug: '\\sb240\\caps', action: '\\sb240', character: '\\sb240\\li3168\\caps', paren: '\\li2304\\ri3456', dialogue: '\\li1440\\ri2160', transition: '\\sb240\\qr\\caps' }[b.type] || '\\sb240';
      if (b.type === 'dialogue' && b.speaker) out.push(P(rtfEscape(b.speaker.toUpperCase()), '\\sb240\\li3168'));
      out.push(P(`{${bridge}${rtfEscape(b.text)}}`, '\\f1' + f));
      continue;
    }
    const text = b.type === 'dialogue' ? proseDialogue(b) : b.type === 'bullet' ? '\\bullet  ' + rtfEscape(b.text) : null;
    if (b.type === 'heading') out.push(P(`{\\b ${rtfEscape(b.text)}}`, '\\sb240\\sa120'));
    else if (b.type === 'quote') out.push(P(`{\\i ${bridge}${rtfEscape(b.text)}}`, '\\li720\\ri720\\sa120'));
    else if (b.type === 'bullet') out.push(P(text, '\\li720\\fi-360\\sa60'));
    else out.push(P(`{${bridge}${rtfEscape(text ?? b.text)}}`, '\\fi720\\sl480\\slmult1'));
  }
  return out.join('');
}

const RTF_HEAD = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fmodern Courier New;}}{\\colortbl;\\red0\\green0\\blue0;\\red31\\green95\\blue175;\\red122\\green92\\blue0;}\n';

export function rtfDoc(title, blocks, kind, opts = DEFAULT_EXPORT_OPTS) {
  return RTF_HEAD + (title ? `{\\pard\\qc\\b\\fs32 ${rtfEscape(title)}\\par}\n` : '') + rtfBlocks(blocks, kind, opts) + '}';
}

export function buildRtf(project, opts = DEFAULT_EXPORT_OPTS) {
  let body = `{\\pard\\qc\\sb2880\\fs36 ${rtfEscape(project.title)}\\par}{\\pard\\qc ${rtfEscape(project.author ? 'by ' + project.author : '')}\\par}\\page\n`;
  for (const it of flatten(project, opts)) {
    if (it.t === 'group') body += `{\\pard\\qc\\b\\sb480\\sa240\\fs28 ${rtfEscape(it.text)}\\par}\n`;
    else if (it.t === 'unit') body += project.kind === 'screenplay' ? '' : `{\\pard\\b\\sb360\\sa120 ${rtfEscape(it.unit.title)}\\par}\n`;
    else if (it.t === 'break') body += '{\\pard\\qc #\\par}\n';
    else body += rtfBlocks([it.block], project.kind, opts);
  }
  return RTF_HEAD + body + '}';
}

// ---------- OPML (Scrivener: File > Import > OPML or OML) ----------

export function buildOpml(project, opts = DEFAULT_EXPORT_OPTS) {
  const note = blocks => blocks.filter(b => opts.includeNotes || !isNoteish(b))
    .map(b => isNoteish(b) ? `[${noteText(b)}]` : b.type === 'dialogue' && project.kind !== 'screenplay' ? proseDialogue(b) : (b.speaker && project.kind === 'screenplay' ? b.speaker.toUpperCase() + '\n' : '') + b.text)
    .join('\n\n');
  const unitXml = u => `      <outline text="${xml(u.title)}" _note="${xml(note(u.blocks))}"${u.summary ? ` summary="${xml(u.summary)}"` : ''}/>`;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', `  <head><title>${xml(project.title)}</title><dateCreated>${new Date(project.created).toUTCString()}</dateCreated></head>`, '  <body>', `    <outline text="${xml(project.title)}">`];
  let group = null;
  let open = false;
  for (const u of project.units) {
    if (u.group !== group) {
      if (open) out.push('    </outline>');
      group = u.group;
      open = !!group;
      if (open) out.push(`    <outline text="${xml(group)}">`);
    }
    out.push(unitXml(u));
  }
  if (open) out.push('    </outline>');
  out.push('    </outline>');
  const secs = bibleSections(project);
  if (secs.length) {
    out.push('    <outline text="Bible">');
    for (const s of secs) {
      out.push(`      <outline text="${xml(s.label)}">`);
      for (const e of s.entities) out.push(`        <outline text="${xml(e.name)}" _note="${xml([e.summary, ...(e.details || []).map(d => '- ' + d)].filter(Boolean).join('\n'))}"/>`);
      out.push('      </outline>');
    }
    out.push('    </outline>');
  }
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

// ---------- Scrivener bundle ----------

export function buildScrivenerBundle(project, opts = DEFAULT_EXPORT_OPTS) {
  const root = fileSafe(project.title);
  const files = [];
  project.units.forEach((u, i) => {
    const name = `${pad(i + 1)} ${u.group ? fileSafe(u.group) + ' - ' : ''}${fileSafe(u.title)}.rtf`;
    files.push({ name: `${root}/Draft/${name}`, data: rtfDoc(opts.includeTitles ? u.title : '', u.blocks.filter(b => opts.includeNotes || !isNoteish(b)), project.kind, opts) });
  });
  for (const s of bibleSections(project)) {
    for (const e of s.entities) {
      const blocks = [{ type: 'para', text: e.summary || '' }, ...(e.details || []).map(d => ({ type: 'bullet', text: d }))];
      files.push({ name: `${root}/Research/${fileSafe(s.label)}/${fileSafe(e.name)}.rtf`, data: rtfDoc(e.name, blocks, 'novel', { ...opts, markBridges: false }) });
    }
  }
  const qs = questionsList(project);
  if (qs.length) files.push({ name: `${root}/Research/Director questions.rtf`, data: rtfDoc('Director questions', qs.map(q => ({ type: 'bullet', text: q })), 'novel', opts) });
  project.takes.forEach((t, i) => {
    files.push({ name: `${root}/Research/Raw takes/${pad(i + 1, 3)} ${new Date(t.created).toISOString().slice(0, 10)}.txt`, data: t.raw });
  });
  files.push({ name: `${root}/${root}.opml`, data: buildOpml(project, opts) });
  if (project.kind === 'screenplay') files.push({ name: `${root}/${root}.fountain`, data: buildFountain(project, opts) });
  files.push({ name: `${root}/HOW TO IMPORT.txt`, data: SCRIVENER_README });
  return zip(files);
}

const SCRIVENER_README = `Importing into Scrivener 3 (Mac or Windows)

Option A, keeps every scene as its own document (best):
  1. Unzip this folder.
  2. In Scrivener, select the Draft (or Manuscript) folder in the Binder.
  3. File > Import > Files..., then select everything inside "Draft". They import in numbered order.
  4. Select the Research folder, then File > Import > Files... and pick the folders inside "Research".

Option B, one step:
  File > Import > OPML or OML File..., and choose the .opml file.
  Scenes, chapters, and the bible come in as a full binder outline with text.

Screenplays: File > Import > Fountain Script... and choose the .fountain file
to land in Scrivener's screenwriting mode.
`;

// ---------- Obsidian vault folder ----------

export function buildObsidianBundle(project, opts = DEFAULT_EXPORT_OPTS) {
  const root = fileSafe(project.title);
  const files = [{ name: `${root}/${root}.md`, data: buildMarkdown(project, { ...opts, includeBible: false }) }];
  for (const s of bibleSections(project)) {
    for (const e of s.entities) {
      const scenes = project.units.filter(u => u.blocks.some(b => b.text.toLowerCase().includes(e.name.toLowerCase())));
      files.push({
        name: `${root}/Bible/${fileSafe(s.label)}/${fileSafe(e.name)}.md`,
        data: [
          '---', `type: ${e.type}`, `project: "[[${root}]]"`, e.aliases?.length ? `aliases: [${e.aliases.map(a => `"${a}"`).join(', ')}]` : null, '---', '',
          `# ${e.name}`, '', e.summary || '', '', ...(e.details || []).map(d => `- ${d}`), '',
          scenes.length ? `## Appears in\n${scenes.map(u => `- ${u.title}`).join('\n')}` : '',
        ].filter(x => x !== null).join('\n') + '\n',
      });
    }
  }
  const qs = questionsList(project);
  if (qs.length) files.push({ name: `${root}/Director questions.md`, data: `# Director questions\n\n${qs.map(q => `- [ ] ${q}`).join('\n')}\n` });
  project.takes.forEach((t, i) => {
    const d = new Date(t.created);
    files.push({ name: `${root}/Takes/${d.toISOString().slice(0, 10)} take ${pad(i + 1, 3)}.md`, data: `---\nproject: "[[${root}]]"\nrecorded: ${d.toISOString()}\n---\n\n${t.summary ? `*${t.summary}*\n\n` : ''}${t.raw}\n` });
  });
  return zip(files);
}

// ---------- JSON (full project, re-importable) ----------

export function buildJson(project) {
  const clean = { ...project, takes: project.takes.map(({ audioId, ...t }) => t) };
  return JSON.stringify({ app: 'voice-director', version: 1, exported: new Date().toISOString(), project: clean }, null, 2);
}
