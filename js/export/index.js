// Export registry: one place that knows every format, its file name, and MIME type.

import { buildDocx } from './docx.js';
import { buildFountain, buildFdx } from './screenplay.js';
import { buildMarkdown, buildText, buildRtf, buildOpml, buildScrivenerBundle, buildObsidianBundle, buildJson } from './text.js';
import { fileSafe, flatten, isNoteish, noteText, proseDialogue, bibleSections, DEFAULT_EXPORT_OPTS } from './common.js';

export { DEFAULT_EXPORT_OPTS };

export const FORMATS = {
  docx: { label: 'Word (.docx)', note: 'Word, Pages, Google Docs, Scrivener', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', build: buildDocx },
  scrivener: { label: 'Scrivener bundle (.zip)', note: 'One RTF per scene + bible + OPML binder', ext: 'zip', suffix: ' (Scrivener)', mime: 'application/zip', build: buildScrivenerBundle },
  fountain: { label: 'Fountain (.fountain)', note: 'Highland, Fade In, WriterSolo, Final Draft, Scrivener', ext: 'fountain', mime: 'text/plain', build: buildFountain },
  fdx: { label: 'Final Draft (.fdx)', note: 'Final Draft 8+', ext: 'fdx', mime: 'application/xml', build: buildFdx },
  markdown: { label: 'Markdown (.md)', note: 'Obsidian, Ulysses, iA Writer, Notion, Bear', ext: 'md', mime: 'text/markdown', build: buildMarkdown },
  obsidian: { label: 'Obsidian vault folder (.zip)', note: 'Draft + a linked note per character, place, idea', ext: 'zip', suffix: ' (Obsidian)', mime: 'application/zip', build: buildObsidianBundle },
  rtf: { label: 'Rich Text (.rtf)', note: 'Opens almost anywhere', ext: 'rtf', mime: 'application/rtf', build: buildRtf },
  opml: { label: 'Outline (.opml)', note: 'Scrivener binder import, outliners', ext: 'opml', mime: 'text/x-opml', build: buildOpml },
  txt: { label: 'Plain text (.txt)', note: 'Scrivener "Import and Split" on #', ext: 'txt', mime: 'text/plain', build: buildText },
  json: { label: 'Full project (.json)', note: 'Backup, or hand to your writing room app', ext: 'json', mime: 'application/json', build: p => buildJson(p) },
  pdfprint: { label: 'Print / PDF', note: 'Opens the print sheet. Pinch out on the preview to save as PDF.', print: true },
};

export function exportFile(project, format, opts = DEFAULT_EXPORT_OPTS) {
  const f = FORMATS[format];
  if (!f || f.print) throw new Error('Unknown export format: ' + format);
  const data = f.build(project, opts);
  const name = `${fileSafe(project.title)}${f.suffix || ''}.${f.ext}`;
  return { name, mime: f.mime, data };
}

const h = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML for the print sheet (and a quick read-only preview). */
export function printHtml(project, opts = DEFAULT_EXPORT_OPTS) {
  const sp = project.kind === 'screenplay';
  const out = [`<div class="pr ${sp ? 'pr-sp' : 'pr-ms'}">`, `<h1 class="pr-title">${h(project.title)}</h1>`];
  if (project.author) out.push(`<p class="pr-by">${sp ? 'written by<br>' : 'by '}${h(project.author)}</p>`);
  out.push('<div class="pr-pb"></div>');
  for (const it of flatten(project, opts)) {
    if (it.t === 'group') out.push(`<h2>${h(it.text)}</h2>`);
    else if (it.t === 'unit') { if (!sp) out.push(`<h3>${h(it.unit.title)}</h3>`); }
    else if (it.t === 'break') out.push('<p class="pr-break">#</p>');
    else {
      const b = it.block;
      const br = opts.markBridges && b.origin === 'bridge' ? ' bridge' : '';
      if (isNoteish(b)) out.push(`<p class="pr-note">${h(noteText(b))}</p>`);
      else if (sp) {
        if (b.type === 'dialogue' && b.speaker) out.push(`<p class="sp-character">${h(b.speaker.toUpperCase())}</p>`);
        out.push(`<p class="sp-${b.type}${br}">${h(b.type === 'paren' && !/^\(/.test(b.text) ? `(${b.text})` : b.text)}</p>`);
      } else if (b.type === 'dialogue') out.push(`<p class="${br}">${h(proseDialogue(b))}</p>`);
      else if (b.type === 'quote') out.push(`<blockquote class="${br}">${h(b.text)}</blockquote>`);
      else if (b.type === 'bullet') out.push(`<p class="pr-li${br}">• ${h(b.text)}</p>`);
      else if (b.type === 'heading') out.push(`<h4>${h(b.text)}</h4>`);
      else out.push(`<p class="${br}">${h(b.text)}</p>`);
    }
  }
  if (opts.includeBible) {
    out.push('<div class="pr-pb"></div><h2>Bible</h2>');
    for (const s of bibleSections(project)) {
      out.push(`<h3>${h(s.label)}</h3>`);
      for (const e of s.entities) out.push(`<h4>${h(e.name)}</h4><p>${h(e.summary)}</p>${(e.details || []).map(d => `<p class="pr-li">• ${h(d)}</p>`).join('')}`);
    }
  }
  out.push('</div>');
  return out.join('\n');
}
