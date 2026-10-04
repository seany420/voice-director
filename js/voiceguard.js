// Voice Guard. Runs on the phone, no AI involved.
// 1. Flags AI tells in a draft (banned words, em dashes, negative parallelisms, flat rhythm).
// 2. Builds a fingerprint of how you actually write from your samples.
// 3. Measures how much of a draft is traceable to words you spoke.

export const DEFAULT_BANNED_WORDS = [
  'delve', 'realm', 'harness', 'unlock', 'tapestry', 'crucial', 'pivotal', 'leverage', 'robust',
  'foster', 'showcase', 'elevate', 'empower', 'seamless', 'testament', 'landscape', 'intricate',
  'meticulous', 'underscore', 'transformative', 'unprecedented', 'holistic', 'enduring', 'interplay',
];

export const DEFAULT_BANNED_PHRASES = [
  "it's worth noting", 'in order to', 'furthermore', 'moreover', 'that said', 'at the end of the day',
  'ultimately', "in today's world", 'serves as', 'stands as', 'a testament to', 'navigate the',
];

export const DEFAULT_RULES = [
  'Never use em dashes. Use commas, periods, colons, or parentheses.',
  'Never use negative parallelisms ("it\'s not X, it\'s Y", "not just X but Y"). Say the positive claim.',
  'Numbers as digits. Contractions always. Say "is", not "serves as" or "represents".',
  'Short paragraphs, 1 to 3 sentences. Vary sentence length hard.',
  'Don\'t list exactly 3 things.',
  'End on a concrete image or a blunt binary. Never a summary or a moral.',
];

export function defaultVoice() {
  return {
    bannedWords: [...DEFAULT_BANNED_WORDS],
    bannedPhrases: [...DEFAULT_BANNED_PHRASES],
    rules: [...DEFAULT_RULES],
    samples: [],          // [{id, title, text}]
    fingerprint: null,
  };
}

const NEG_PARALLEL = [
  /\b(?:it|this|that)(?:['’]s not| is not| isn['’]t| was not| wasn['’]t) (?:just |only |merely |about )?[^.;,!?]{1,60}[.,;:]\s*(?:it|this|that)(?:['’]s| is| was)\b/i,
  /\bnot (?:just|only|merely) [^.;!?]{1,60},? but(?: also)?\b/i,
  /\bisn't (?:about|just) [^.;!?]{1,60}[.;,]\s*(?:it's|it is) (?:about)?/i,
  /\bthe (?:question|point|problem|issue) (?:isn't|is not|wasn't) [^.;!?]{1,60}[.;,]/i,
  /\bforget [^.;!?]{1,40}[.;,]\s*this is\b/i,
  /\bstop [a-z]+ing [^.;!?]{1,40} and start [a-z]+ing\b/i,
  /\bless (?:about|of) [^.;!?]{1,40} (?:and )?more (?:about|of)\b/i,
];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sentenceLengths(text) {
  return String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
    .map(s => s.split(/\s+/).filter(Boolean).length);
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const stdev = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map(x => (x - m) ** 2))) : 0; };

/** Lint one passage. Returns [{type, severity, match, index, message, fix?}] */
export function lint(text, voice = defaultVoice()) {
  const out = [];
  const s = String(text || '');
  let m;

  const dash = /\s*[—–]\s*|\s--\s/g;
  while ((m = dash.exec(s))) {
    out.push({ type: 'emdash', severity: 'high', match: m[0], index: m.index, message: 'Em dash', fix: ', ' });
  }
  for (const w of voice.bannedWords || []) {
    const re = new RegExp(`\\b${escapeRe(w)}(?:s|es|ed|d|ing|ly)?\\b`, 'gi');
    while ((m = re.exec(s))) out.push({ type: 'word', severity: 'high', match: m[0], index: m.index, message: `Banned word "${w}"` });
  }
  for (const p of voice.bannedPhrases || []) {
    const re = new RegExp(`\\b${escapeRe(p)}\\b`, 'gi');
    while ((m = re.exec(s))) out.push({ type: 'phrase', severity: 'med', match: m[0], index: m.index, message: `Banned phrase "${p}"` });
  }
  for (const re of NEG_PARALLEL) {
    const g = new RegExp(re.source, 'gi');
    while ((m = g.exec(s))) out.push({ type: 'negpar', severity: 'high', match: m[0], index: m.index, message: 'Negative parallelism. Say the positive claim.' });
  }
  const triad = /\b(\w+(?: \w+)?), (\w+(?: \w+)?),? and (\w+(?: \w+)?)\b/g;
  while ((m = triad.exec(s))) out.push({ type: 'triad', severity: 'low', match: m[0], index: m.index, message: 'List of exactly 3' });

  const lens = sentenceLengths(s);
  if (lens.length >= 5) {
    const sd = stdev(lens);
    if (sd < 4) out.push({ type: 'rhythm', severity: 'med', match: '', index: 0, message: `Even rhythm (sentence length spread ${sd.toFixed(1)} words). Break it up.` });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Auto-fix the safe ones: em dashes. Everything else needs a human. */
export function autofix(text) {
  return String(text || '')
    .replace(/\s*[—–]\s*([a-z])/g, ', $1')
    .replace(/\s*[—–]\s*/g, '. ')
    .replace(/\s--\s/g, ', ')
    .replace(/\.\s+\./g, '.')
    .replace(/,\s*,/g, ',');
}

/** Fingerprint from writing samples: numbers the Director can match. */
export function fingerprint(samples) {
  const text = samples.map(s => s.text || '').join('\n\n');
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 30) return null;
  const lens = sentenceLengths(text);
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const paraSent = paras.map(p => sentenceLengths(p).length);
  const contractions = words.filter(w => /'(?:s|t|re|ve|ll|d|m)$/.test(w)).length;
  const fragments = lens.filter(n => n <= 4).length;
  const long = lens.filter(n => n >= 25).length;
  const per1k = n => +(n / words.length * 1000).toFixed(1);
  const punct = {
    colons: per1k((text.match(/:/g) || []).length),
    semicolons: per1k((text.match(/;/g) || []).length),
    parens: per1k((text.match(/\(/g) || []).length),
    questions: per1k((text.match(/\?/g) || []).length),
    emdashes: per1k((text.match(/[—–]/g) || []).length),
  };
  const firstPerson = per1k(words.filter(w => ['i', "i'm", "i've", "i'd", "i'll", 'me', 'my'].includes(w)).length);
  const stop = new Set('the a an and or but of to in on at for with is was are were be been it its this that i you he she they we my your his her their me him them our as by from not no so if then than just very there what when who how all do did does have had has like'.split(' '));
  const freq = {};
  for (const w of words) if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  const signature = Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
  return {
    words: words.length,
    avgSentence: +mean(lens).toFixed(1),
    sentenceSpread: +stdev(lens).toFixed(1),
    fragmentRate: +(fragments / Math.max(1, lens.length) * 100).toFixed(0),
    longRate: +(long / Math.max(1, lens.length) * 100).toFixed(0),
    avgParagraph: +mean(paraSent).toFixed(1),
    contractionsPer1k: per1k(contractions),
    firstPersonPer1k: firstPerson,
    punct,
    signature,
  };
}

export function describeFingerprint(fp) {
  if (!fp) return '';
  return [
    `Average sentence ${fp.avgSentence} words, spread ${fp.sentenceSpread} (high spread = varied rhythm).`,
    `${fp.fragmentRate}% of sentences are fragments of 4 words or fewer; ${fp.longRate}% run 25+ words.`,
    `Paragraphs average ${fp.avgParagraph} sentences.`,
    `${fp.contractionsPer1k} contractions and ${fp.firstPersonPer1k} first-person words per 1,000 words.`,
    `Per 1,000 words: ${fp.punct.colons} colons, ${fp.punct.parens} parentheses, ${fp.punct.questions} questions, ${fp.punct.semicolons} semicolons, ${fp.punct.emdashes} em dashes.`,
    fp.signature.length ? `Words this writer leans on: ${fp.signature.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

// ---------- authenticity: how much of the draft came out of your mouth ----------

const norm = s => String(s || '').toLowerCase().replace(/⟦[^⟧]*⟧/g, ' ').replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);

export function trigramSet(texts) {
  const set = new Set();
  for (const t of texts) {
    const w = norm(t);
    for (let i = 0; i + 2 < w.length; i++) set.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
  }
  return set;
}

/** Share of the passage's word trigrams that also appear in what you spoke. 0..1, or null if too short. */
export function authenticity(text, spokenSet) {
  const w = norm(text);
  if (w.length < 3) return null;
  let hit = 0, total = 0;
  for (let i = 0; i + 2 < w.length; i++) {
    total++;
    if (spokenSet.has(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2])) hit++;
  }
  return total ? hit / total : null;
}
