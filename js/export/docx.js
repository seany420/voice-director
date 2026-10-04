// Word .docx, built by hand (OOXML in a zip). Opens in Word, Pages, Google Docs,
// and imports cleanly into Scrivener. Formatting follows the project type:
// screenplays get industry layout, fiction gets standard manuscript format.

import { zip } from './zip.js';
import { xml, flatten, isNoteish, noteText, proseDialogue, bibleSections, questionsList, DEFAULT_EXPORT_OPTS } from './common.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PROFILES = {
  screenplay: { font: 'Courier New', size: 24, line: 240, indent: 0, after: 0, margins: { top: 1440, bottom: 1440, left: 2160, right: 1440 } },
  novel: { font: 'Times New Roman', size: 24, line: 480, indent: 720, after: 0, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  memoir: { font: 'Times New Roman', size: 24, line: 480, indent: 720, after: 0, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  nonfiction: { font: 'Times New Roman', size: 24, line: 480, indent: 720, after: 0, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  academic: { font: 'Times New Roman', size: 24, line: 480, indent: 720, after: 0, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  essay: { font: 'Georgia', size: 23, line: 300, indent: 0, after: 200, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  research: { font: 'Calibri', size: 22, line: 276, indent: 0, after: 120, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  journal: { font: 'Georgia', size: 23, line: 300, indent: 0, after: 200, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
};

function styles(p) {
  const s = (id, name, pPr = '', rPr = '', basedOn = 'Normal', extra = '') =>
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/>${extra}<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
  const sp = (before, after = 0) => `<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>`;
  const ind = (left, right = 0) => `<w:ind w:left="${left}" w:right="${right}" w:firstLine="0"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${p.font}" w:hAnsi="${p.font}" w:cs="${p.font}" w:eastAsia="${p.font}"/><w:sz w:val="${p.size}"/><w:szCs w:val="${p.size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="${p.after}" w:line="${p.line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${p.indent}"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2880" w:after="240"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="${p.size + 12}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="${p.size + 4}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
${s('SceneBreak', 'Scene Break', '<w:jc w:val="center"/><w:ind w:firstLine="0"/>')}
${s('Quote', 'Quote', '<w:ind w:left="720" w:right="720" w:firstLine="0"/>', '<w:i/>')}
${s('ListBullet', 'List Bullet', '<w:ind w:left="720" w:hanging="360"/>')}
${s('DirectorNote', 'Director Note', '<w:ind w:firstLine="0"/><w:shd w:val="clear" w:color="auto" w:fill="FFF4CC"/>', '<w:i/><w:color w:val="7A5C00"/><w:sz w:val="20"/>')}
${s('SceneHeading', 'Scene Heading', sp(240) + ind(0), '<w:caps/>', 'Normal', '<w:next w:val="Action"/>')}
${s('Action', 'Action', sp(240) + ind(0))}
${s('Character', 'Character', sp(240) + ind(3168) + '<w:keepNext/>', '<w:caps/>', 'Normal', '<w:next w:val="Dialogue"/>')}
${s('Parenthetical', 'Parenthetical', sp(0) + ind(2304, 3456) + '<w:keepNext/>')}
${s('Dialogue', 'Dialogue', sp(0) + ind(1440, 2160))}
${s('Transition', 'Transition', sp(240) + ind(0) + '<w:jc w:val="right"/>', '<w:caps/>')}
</w:styles>`;
}

function run(text, rPr = '') {
  // Preserve line breaks inside a block.
  const parts = String(text).split('\n');
  return parts.map((t, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`).join('');
}

const para = (style, body, pPrExtra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pPrExtra}</w:pPr>${body}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function blockXml(b, kind, opts) {
  const bridge = opts.markBridges && b.origin === 'bridge' ? '<w:color w:val="1F5FAF"/><w:u w:val="dotted"/>' : '';
  if (isNoteish(b)) return para('DirectorNote', run(noteText(b), b.type === 'tk' ? '<w:highlight w:val="yellow"/>' : ''));
  if (kind === 'screenplay') {
    const map = { slug: 'SceneHeading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', heading: 'SceneHeading', para: 'Action', quote: 'Action', bullet: 'Action' };
    let text = b.text;
    if (b.type === 'paren' && !/^\(.*\)$/.test(text.trim())) text = `(${text.trim()})`;
    if (b.type === 'dialogue' && b.speaker && !opts._lastWasCharacter) {
      return para('Character', run(b.speaker.toUpperCase())) + para('Dialogue', run(text, bridge));
    }
    return para(map[b.type] || 'Action', run(text, bridge));
  }
  switch (b.type) {
    case 'heading': return para('Heading3', run(b.text, bridge));
    case 'quote': return para('Quote', run(b.text, bridge));
    case 'bullet': return para('ListBullet', run('• ' + b.text.replace(/^[•\-*]\s*/, ''), bridge));
    // Prose dialogue: quote marks only. No invented "she says" tags.
    case 'dialogue': return para('', run(proseDialogue(b), bridge));
    default: return para('', run(b.text, bridge));
  }
}

export function documentXml(project, opts = DEFAULT_EXPORT_OPTS) {
  const p = PROFILES[project.kind] || PROFILES.novel;
  const kind = project.kind;
  const body = [];

  // Title page
  body.push(para('Title', run(project.title)));
  if (project.author) body.push(para('Subtitle', run(kind === 'screenplay' ? `written by\n${project.author}` : `by ${project.author}`)));
  if (project.logline && kind !== 'screenplay') body.push(para('Subtitle', run(project.logline, '<w:i/><w:sz w:val="20"/>')));
  body.push(pageBreak);

  let firstGroup = true;
  let prevType = null;
  for (const it of flatten(project, opts)) {
    if (it.t === 'group') {
      if (!firstGroup && kind !== 'screenplay') body.push(pageBreak);
      body.push(para('Heading1', run(it.text)));
      firstGroup = false;
    } else if (it.t === 'unit') {
      if (kind !== 'screenplay') body.push(para('Heading2', run(it.unit.title)));
    } else if (it.t === 'break') {
      body.push(para('SceneBreak', run('#')));
    } else {
      body.push(blockXml(it.block, kind, { ...opts, _lastWasCharacter: prevType === 'character' }));
      prevType = it.block.type;
    }
  }

  if (opts.includeBible) {
    body.push(pageBreak, para('Heading1', run('Bible')));
    for (const s of bibleSections(project)) {
      body.push(para('Heading2', run(s.label)));
      for (const e of s.entities) {
        body.push(para('Heading3', run(e.name + (e.aliases?.length ? ` (${e.aliases.join(', ')})` : ''))));
        if (e.summary) body.push(para('', run(e.summary)));
        for (const d of e.details || []) body.push(para('ListBullet', run('• ' + d)));
      }
    }
    const qs = questionsList(project);
    if (qs.length) {
      body.push(para('Heading2', run('Open questions from the Director')));
      for (const q of qs) body.push(para('ListBullet', run('• ' + q)));
    }
  }

  const m = p.margins;
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}${sect}</w:body></w:document>`;
}

function headerXml(project) {
  const surname = (project.author || '').trim().split(/\s+/).pop() || '';
  const left = project.kind === 'screenplay' ? '' : `${surname ? surname + ' / ' : ''}${project.title.toUpperCase()} / `;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:jc w:val="right"/><w:ind w:firstLine="0"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>
<w:r><w:t xml:space="preserve">${xml(left)}</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>${project.kind === 'screenplay' ? '<w:r><w:t>.</w:t></w:r>' : ''}</w:p></w:hdr>`;
}

export function buildDocx(project, opts = DEFAULT_EXPORT_OPTS) {
  const p = PROFILES[project.kind] || PROFILES.novel;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>` },
    { name: 'word/document.xml', data: documentXml(project, opts) },
    { name: 'word/styles.xml', data: styles(p) },
    { name: 'word/header1.xml', data: headerXml(project) },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(project.title)}</dc:title><dc:creator>${xml(project.author || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
  ]);
}
