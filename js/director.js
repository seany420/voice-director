// The Director: one Claude call per take. It reads the project so far, reads the new
// take, and returns placements (which scene/chapter/section each passage belongs in),
// bible updates, and questions for the author. Output is schema-constrained JSON.

import { Anthropic } from '../vendor/anthropic.mjs';
import { kindOf, EDIT_LEVELS, BLOCK_TYPES } from './kinds.js';
import { applyCues, MARK } from './cues.js';
import { describeFingerprint } from './voiceguard.js';

export const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5 (best structure, default)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (faster, cheaper)',
  'claude-fable-5-1': 'Claude Fable 5.1 (most capable, priciest)',
};

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

export function buildSchema(kind) {
  const k = kindOf(kind);
  const str = { type: 'string' };
  const arr = items => ({ type: 'array', items });
  const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
  return obj({
    take_summary: str,
    logline: str,
    placements: arr(obj({
      target: str,
      unit_type: { type: 'string', enum: ['scene', 'chapter', 'section'] },
      title: str,
      group: str,
      beat: str,
      summary: str,
      blocks: arr(obj({
        type: { type: 'string', enum: k.blocks },
        text: str,
        speaker: str,
        origin: { type: 'string', enum: ['spoken', 'bridge'] },
      })),
    })),
    entities: arr(obj({
      ref: str,
      type: { type: 'string', enum: Object.keys(k.entities) },
      name: str,
      aliases: arr(str),
      summary: str,
      details: arr(str),
    })),
    flags: arr(obj({
      kind: { type: 'string', enum: ['question', 'continuity', 'missing', 'idea'] },
      text: str,
    })),
  });
}

export function systemPrompt(project, voice) {
  const k = kindOf(project.kind);
  const lvl = EDIT_LEVELS[project.editLevel] || EDIT_LEVELS.clean;
  const fp = describeFingerprint(voice?.fingerprint);
  const samples = (voice?.samples || []).map(s => s.text).join('\n\n---\n\n');
  const blockList = k.blocks.map(b => `${b} (${BLOCK_TYPES[b]})`).join(', ');
  const entityList = Object.entries(k.entities).map(([id, label]) => `${id} (${label})`).join(', ');

  return `You are the Director inside Voice Director, an app a writer talks into. They speak raw thought, retellings, half-scenes, and asides. You sort what they said into a ${k.label.toLowerCase()} project so it reads like their own draft, organized.

You are an editor and an archivist, not a co-writer. The writer's voice is the product. A reader should never be able to tell an AI touched this.

${lvl.rule}

HARD RULES
- Everything you place must come from the take. Never invent events, images, dialogue, facts, names, sources, or feelings.
- When something is needed but wasn't said (a missing location, a name, a transition), insert a "tk" block describing the gap, e.g. "TK: how she got to the hospital". Do not fill it.
- Keep their vocabulary. Don't upgrade plain words. Don't smooth their rhythm into even sentences. Keep fragments if they spoke in fragments.
- Each block's origin is "spoken" if its words came from the take, "bridge" only for connective words you had to add (allowed at SHAPE level only).
- Never write em dashes. Never write negative parallelisms ("it's not X, it's Y", "not just X but Y").
${(voice?.rules || []).map(r => '- ' + r).join('\n')}
${voice?.bannedWords?.length ? `- Never use these words: ${voice.bannedWords.join(', ')}.` : ''}
${voice?.bannedPhrases?.length ? `- Never use these phrases: ${voice.bannedPhrases.join('; ')}.` : ''}

PROJECT TYPE: ${k.label}
${k.guidance}

Block types you may use: ${blockList}.
For "character" + "dialogue" pairs in a screenplay, put the name in its own character block, then the line in a dialogue block. For dialogue blocks in prose, set speaker to the character's name.
Entity types: ${entityList}.
Story structure beats (use one of these exact labels in "beat" when a passage clearly fits, else ""): ${k.arc.join(' | ')}.

SPOKEN CUES in the take (already converted to markers):
- ${MARK.unit}:scene⟧ (or chapter/section/...) = the writer asked for a new unit here. Start a new placement.
- ${MARK.para} = paragraph break.
- ${MARK.note} ... ${MARK.endNote} = a note to self. Make it a "note" block, never prose.
- ${MARK.keep} ... ${MARK.endKeep} = protected text. Copy it exactly, character for character, no edits at all.
- ${MARK.hint}:character⟧ (or setting, idea, ...) = what follows is bible material of that type.
Never output the markers themselves.

HOW TO PLACE
- "target" is the id of an existing unit when the passage continues or belongs in it (even an earlier one; writers jump around). Use "NEW" for a new unit.
- One take can produce several placements. Keep the writer's order inside each placement.
- "title" is a short working title (for an existing target, repeat its title). "group" is a chapter/act/part label if the writer gave one, else "". "summary" is 1 sentence on what the unit holds now.
- Entities: "ref" is the existing entity id when updating one, else "". Put only new information in "details", short and concrete, using the writer's words. "summary" is 1 to 2 plain sentences.
- Flags: continuity problems with earlier material, things the writer seems to have forgotten, questions to ask them, and ideas worth chasing. Ask like a sharp editor would, briefly.
- "logline" is a 1-sentence description of the whole project as it stands, in plain words. Repeat the existing one if nothing changed.
- "take_summary" is 1 sentence describing this take.
${fp ? `\nWRITER FINGERPRINT (measured from their own writing; match it when you clean or shape):\n${fp}` : ''}
${samples ? `\nWRITING SAMPLES (how this writer sounds on the page; use them to judge what "their voice" means, never quote them into the draft):\n<samples>\n${clip(samples, 24000)}\n</samples>` : ''}`;
}

export function projectContext(project, { maxBlockChars = 600 } = {}) {
  const k = kindOf(project.kind);
  const lines = [`TITLE: ${project.title}`, `LOGLINE: ${project.logline || '(none yet)'}`, ''];
  lines.push(`${k.unitPlural.toUpperCase()} SO FAR (${project.units.length}):`);
  if (!project.units.length) lines.push('(none yet)');
  for (const u of project.units) {
    lines.push(`- id=${u.id} | ${u.type} | ${u.group ? u.group + ' / ' : ''}${u.title}${u.beat ? ' | beat: ' + u.beat : ''} | ${u.blocks.length} blocks`);
    if (u.summary) lines.push(`  summary: ${u.summary}`);
    const tail = u.blocks.slice(-2).map(b => `${b.type}${b.speaker ? '(' + b.speaker + ')' : ''}: ${clip(b.text, maxBlockChars)}`);
    if (tail.length) lines.push(`  ends with: ${tail.join(' / ')}`);
  }
  lines.push('', 'BIBLE SO FAR:');
  if (!project.entities.length) lines.push('(empty)');
  for (const e of project.entities) {
    lines.push(`- id=${e.id} | ${e.type} | ${e.name}${e.aliases?.length ? ' (aka ' + e.aliases.join(', ') + ')' : ''}: ${clip(e.summary, 300)}${e.details?.length ? ' | known: ' + clip(e.details.join('; '), 500) : ''}`);
  }
  const open = project.questions.filter(q => !q.resolved);
  if (open.length) {
    lines.push('', 'OPEN QUESTIONS ALREADY ASKED (don\'t repeat these):');
    for (const q of open.slice(-20)) lines.push(`- ${q.text}`);
  }
  return lines.join('\n');
}

export function prepareTake(raw) {
  return applyCues(raw);
}

function makeClient(settings) {
  if (!settings.apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch: settings.fetch });
}

// Text after the last fallback boundary is the answer that counts.
function finalText(message) {
  const content = message.content || [];
  let start = 0;
  content.forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return content.slice(start).filter(b => b.type === 'text').map(b => b.text).join('');
}

function explain(err) {
  const s = err?.status;
  if (s === 401) return 'Claude rejected the API key. Check it in Settings.';
  if (s === 403) return 'This API key does not have access to that model.';
  if (s === 404) return 'Model not found. Pick another model in Settings.';
  if (s === 429) return 'Rate limited by Claude. Wait a minute and try again.';
  if (s >= 500) return 'Claude is having trouble right now. Try again shortly.';
  if (err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError') return 'No connection to Claude. The take is saved; process it when you have signal.';
  return err?.message || String(err);
}

async function streamJSONish(settings, params, onProgress, signal) {
  const client = makeClient(settings);
  const useFallback = settings.fallbacks !== false;
  const run = async (withFallback) => {
    const req = withFallback ? { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } : params;
    const stream = client.beta.messages.stream(req, { signal });
    let chars = 0;
    stream.on('text', (delta) => { chars += delta.length; onProgress?.(chars); });
    return stream.finalMessage();
  };
  let msg;
  try {
    msg = await run(useFallback);
  } catch (err) {
    // Some accounts or models may not accept the fallback beta yet. Retry once without it.
    if (useFallback && err?.status === 400 && /fallback/i.test(err?.message || '')) msg = await run(false);
    else throw err;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this take. Try a different model in Settings, or edit the take and rerun it.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The Director ran out of room on this take. Split it into 2 shorter takes and rerun.');
  return { text: finalText(msg), usage: msg.usage, model: msg.model };
}

/** Process one take. Returns {result, usage, prepared, cues}. */
export async function directTake({ project, take, voice, settings, onProgress, signal }) {
  const { text: prepared, cues } = prepareTake(take.raw);
  const params = {
    model: settings.model || 'claude-opus-5-5',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: settings.effort || 'high', format: { type: 'json_schema', schema: buildSchema(project.kind) } },
    system: [{ type: 'text', text: systemPrompt(project, voice), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `${projectContext(project)}\n\nNEW TAKE (recorded ${new Date(take.created).toLocaleString()}):\n<take>\n${prepared}\n</take>\n\nPlace this take into the project.`,
    }],
  };
  try {
    const { text, usage, model } = await streamJSONish(settings, params, onProgress, signal);
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('The Director returned something unreadable. Rerun the take.'); }
    return { result, usage, model, prepared, cues };
  } catch (err) {
    throw new Error(explain(err));
  }
}

/** Free-form question about the project ("what's missing from act 2?"). */
export async function askDirector({ project, voice, settings, question, onProgress, signal }) {
  const params = {
    model: settings.model || 'claude-opus-5-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: settings.effort || 'high' },
    system: [{ type: 'text', text: systemPrompt(project, voice) + `\n\nRight now the writer is asking you a question about the project instead of giving you a take. Answer like a blunt, kind developmental editor: short, specific, pointing at their actual material by title. No preamble, no summary at the end. Plain text, no markdown headers.`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `${projectContext(project, { maxBlockChars: 1500 })}\n\nFULL DRAFT:\n${draftText(project)}\n\nQUESTION: ${question}` }],
  };
  try {
    return (await streamJSONish(settings, params, onProgress, signal)).text;
  } catch (err) {
    throw new Error(explain(err));
  }
}

export function draftText(project) {
  return project.units.map(u => `## ${u.title}\n` + u.blocks.map(b => (b.speaker ? b.speaker + ': ' : '') + b.text).join('\n')).join('\n\n');
}

/** Cheap call to confirm the key and model work. */
export async function pingClaude(settings) {
  try {
    const client = makeClient(settings);
    await client.messages.create({
      model: settings.model || 'claude-opus-5-5',
      max_tokens: 256,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    });
    return true;
  } catch (err) {
    throw new Error(explain(err));
  }
}
