// Spoken director cues. Said out loud while recording, turned into markers
// before anything reaches Claude, so the structure you speak is the structure you get.
//
//   "new scene" / "new chapter" / "new section"  -> unit break
//   "new paragraph"                              -> paragraph break
//   "scratch that" / "delete that"               -> drops the sentence before it
//   "note to self ..."                           -> note (to end of sentence)
//   "verbatim ... end verbatim"                  -> protected text, never edited
//   "character note" / "setting note" / "idea"   -> hint for the bible

export const MARK = {
  unit: '⟦BREAK',          // ⟦BREAK:scene⟧
  para: '⟦PARA⟧',
  note: '⟦NOTE⟧',
  endNote: '⟦/NOTE⟧',
  keep: '⟦VERBATIM⟧',
  endKeep: '⟦/VERBATIM⟧',
  hint: '⟦HINT',           // ⟦HINT:character⟧
};

const UNIT_WORDS = 'scene|chapter|section|part|act|topic|thread|beat';
const HINT_WORDS = 'character|setting|location|place|plot|theme|idea|source|research|todo|to do|person';

// Sentence splitter that keeps the terminator with the sentence.
export function sentences(text) {
  const out = [];
  const re = /[^.!?]+(?:[.!?]+["'”’)]*|$)/g;
  let m;
  while ((m = re.exec(text)) && m[0]) {
    const s = m[0];
    if (s.trim()) out.push(s);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

export function applyCues(raw) {
  const found = [];
  let t = ' ' + String(raw || '').replace(/\s+/g, ' ') + ' ';

  // Protected spans first so nothing inside them is touched.
  const kept = [];
  t = t.replace(/\b(?:verbatim|keep this exact(?:ly)?|quote me)[,:.]?\s+(.*?)(?:\s*\b(?:end verbatim|end quote me|end exact)\b[.,]?|$)/gi, (_, body) => {
    kept.push(body.trim());
    found.push({ cue: 'verbatim', text: body.trim() });
    return ` ${MARK.keep}§${kept.length - 1}§${MARK.endKeep} `;
  });

  // "scratch that" removes the sentence before it.
  for (let guard = 0; guard < 200; guard++) {
    const m = /\b(?:scratch that|delete that|strike that|cut that)\b[.,!]?/i.exec(t);
    if (!m) break;
    const before = t.slice(0, m.index);
    const after = t.slice(m.index + m[0].length);
    const parts = sentences(before);
    const dropped = (parts.length && !/^\s*[.,!?]*\s*$/.test(before)) ? parts.pop() : '';
    // Said mid-sentence, it drops the sentence in progress.
    found.push({ cue: 'scratch', text: (dropped || '').trim() });
    t = parts.join('') + ' ' + after;
  }

  t = t.replace(new RegExp(`\\b(?:new|next|start(?: a)?(?: new)?)\\s+(${UNIT_WORDS})\\b[.,:]?`, 'gi'), (_, u) => {
    const unit = u.toLowerCase();
    found.push({ cue: 'break', unit });
    return ` ${MARK.unit}:${unit}⟧ `;
  });

  t = t.replace(/\b(?:new paragraph|next paragraph)\b[.,]?/gi, () => {
    found.push({ cue: 'paragraph' });
    return ` ${MARK.para} `;
  });

  t = t.replace(/\b(?:note to self|reminder to self|director'?s? note)[,:.]?\s+([^.!?]*[.!?]?)/gi, (_, body) => {
    found.push({ cue: 'note', text: body.trim() });
    return ` ${MARK.note} ${body.trim()} ${MARK.endNote} `;
  });

  t = t.replace(new RegExp(`\\b(${HINT_WORDS})\\s+note\\b[,:.]?`, 'gi'), (_, h) => {
    const hint = h.toLowerCase().replace('to do', 'todo');
    found.push({ cue: 'hint', hint });
    return ` ${MARK.hint}:${hint}⟧ `;
  });

  t = t.replace(/§(\d+)§/g, (_, i) => kept[+i]);
  t = t.replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  return { text: t, cues: found };
}

// Strip markers for display or for word-count style metrics.
export function stripMarkers(text) {
  return String(text || '').replace(/⟦[^⟧]*⟧/g, ' ').replace(/\s+/g, ' ').trim();
}
