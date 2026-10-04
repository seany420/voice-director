// Fountain (plain-text screenplay: Highland, Fade In, WriterSolo, Scrivener, Final Draft import)
// and FDX (Final Draft's own XML).

import { xml, isNoteish, noteText, today, DEFAULT_EXPORT_OPTS } from './common.js';

const SLUG_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

function screenplayLines(project, opts) {
  // Normalized screenplay elements, shared by both formats.
  const out = [];
  let group = null;
  let lastChar = '';
  for (const u of project.units) {
    if (u.group && u.group !== group) { out.push({ type: 'section', text: u.group }); group = u.group; }
    if (opts.includeTitles && u.summary) out.push({ type: 'synopsis', text: u.summary });
    const hasSlug = u.blocks.some(b => b.type === 'slug');
    if (!hasSlug) out.push({ type: 'slug', text: `INT. ${u.title.toUpperCase()} - TK` });
    for (const b of u.blocks) {
      if (isNoteish(b)) { if (opts.includeNotes) out.push({ type: 'note', text: noteText(b) }); continue; }
      if (b.type === 'dialogue') {
        if (b.speaker && b.speaker.toUpperCase() !== lastChar) out.push({ type: 'character', text: b.speaker.toUpperCase() });
        out.push({ type: 'dialogue', text: b.text });
        continue;
      }
      if (b.type === 'character') { lastChar = b.text.trim().toUpperCase(); out.push({ type: 'character', text: lastChar }); continue; }
      if (b.type === 'paren') { out.push({ type: 'paren', text: /^\(.*\)$/.test(b.text.trim()) ? b.text.trim() : `(${b.text.trim()})` }); continue; }
      lastChar = '';
      out.push({ type: b.type === 'slug' || b.type === 'transition' ? b.type : 'action', text: b.text });
    }
  }
  return out;
}

export function buildFountain(project, opts = DEFAULT_EXPORT_OPTS) {
  const lines = [`Title: ${project.title}`];
  if (project.author) lines.push('Credit: written by', `Author: ${project.author}`);
  lines.push(`Draft date: ${today()}`, '', '');
  let prev = '';
  for (const el of screenplayLines(project, opts)) {
    const t = el.text.trim();
    switch (el.type) {
      case 'section': lines.push(`# ${t}`, ''); break;
      case 'synopsis': lines.push(`= ${t}`, ''); break;
      case 'slug': {
        const up = t.toUpperCase();
        lines.push(SLUG_RE.test(up) ? up : `.${up}`, '');
        break;
      }
      case 'character': if (prev === 'dialogue' || prev === 'paren') lines.push(''); lines.push(t.toUpperCase()); break;
      case 'paren': lines.push(t); break;
      case 'dialogue': lines.push(t); break;
      case 'transition': {
        if (prev === 'dialogue' || prev === 'paren') lines.push('');
        const up = t.toUpperCase();
        lines.push(/TO:$/.test(up) ? up : `> ${up}`, '');
        break;
      }
      case 'note': if (prev === 'dialogue' || prev === 'paren') lines.push(''); lines.push(`[[${t}]]`, ''); break;
      default: {
        if (prev === 'dialogue' || prev === 'paren') lines.push('');
        // An all-caps action line would be read as a character cue. Force it.
        lines.push(t === t.toUpperCase() && /[A-Z]/.test(t) ? `!${t}` : t, '');
      }
    }
    prev = el.type;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function buildFdx(project, opts = DEFAULT_EXPORT_OPTS) {
  const typeMap = { slug: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', note: 'General', section: 'General', synopsis: 'General' };
  const paras = screenplayLines(project, opts).map(el => {
    let text = el.text.trim();
    if (el.type === 'slug' || el.type === 'character' || el.type === 'transition') text = text.toUpperCase();
    if (el.type === 'section') text = text.toUpperCase();
    return `    <Paragraph Type="${typeMap[el.type] || 'Action'}"><Text>${xml(text)}</Text></Paragraph>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join('\n')}
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Alignment="Center" Type="General"><Text>${xml(project.title.toUpperCase())}</Text></Paragraph>
      <Paragraph Alignment="Center" Type="General"><Text>written by</Text></Paragraph>
      <Paragraph Alignment="Center" Type="General"><Text>${xml(project.author || '')}</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>
`;
}
