// Project kinds. Each kind tells the Director what to pull out of a take,
// how to shape the draft, and which exports make sense.

export const BLOCK_TYPES = {
  heading: 'Heading',
  para: 'Paragraph',
  slug: 'Scene heading',
  action: 'Action',
  character: 'Character',
  paren: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  quote: 'Quote',
  bullet: 'Bullet',
  note: 'Note to self',
  cite: 'Citation needed',
  tk: 'TK (gap)',
};

export const KINDS = {
  screenplay: {
    label: 'Screenplay',
    icon: '🎬',
    unit: 'scene',
    unitPlural: 'Scenes',
    blocks: ['slug', 'action', 'character', 'paren', 'dialogue', 'transition', 'note', 'tk'],
    entities: {
      character: 'Characters',
      location: 'Locations & scenery',
      prop: 'Props & objects',
      theme: 'Themes & motifs',
    },
    arc: ['Opening image', 'Setup', 'Catalyst', 'Debate', 'Break into 2', 'B story', 'Fun & games', 'Midpoint', 'Bad guys close in', 'All is lost', 'Dark night', 'Break into 3', 'Finale', 'Final image'],
    guidance: `Format as a screenplay. Every scene opens with a slug (INT./EXT. LOCATION - DAY/NIGHT). If the speaker didn't say interior/exterior or time, infer only when obvious, else write the slug with a TK, e.g. "INT. TK - NIGHT".
Action lines: present tense, what the camera sees and hears. Keep the speaker's images and verbs.
Dialogue: when the speaker retells what a character said ("and then she tells him get out"), turn it into a character block (NAME in caps) plus a dialogue block, keeping their words. Parentheticals only when the speaker gave a delivery note.
Track every named character, location, and meaningful prop as entities. Map story moments to the beat sheet when the fit is clear.`,
    exports: ['fountain', 'fdx', 'docx', 'pdfprint', 'scrivener', 'markdown', 'txt', 'json'],
  },
  novel: {
    label: 'Novel / fiction',
    icon: '📖',
    unit: 'scene',
    unitPlural: 'Chapters & scenes',
    blocks: ['heading', 'para', 'dialogue', 'note', 'tk'],
    entities: {
      character: 'Characters',
      setting: 'Settings',
      thread: 'Plot threads',
      theme: 'Themes & motifs',
      world: 'World rules & lore',
    },
    arc: ['Hook', 'Inciting incident', 'First plot point', 'First pinch', 'Midpoint', 'Second pinch', 'Crisis', 'Climax', 'Resolution'],
    guidance: `Shape prose scenes. Each unit is a scene, titled with a short working title, grouped under a chapter label in its "group" field when the speaker names one.
Write dialogue as prose paragraphs with quotation marks (para blocks), or as dialogue blocks with a speaker when it's a back-and-forth.
Keep the speaker's POV and tense. If they switch tense mid-take, keep the dominant one and add a note block flagging the switch.
Track characters (with what they want, what they fear, how they talk), settings (with sensory detail the speaker gave), plot threads, motifs.`,
    exports: ['docx', 'scrivener', 'markdown', 'obsidian', 'rtf', 'txt', 'json'],
  },
  memoir: {
    label: 'Memoir / biography',
    icon: '🪞',
    unit: 'chapter',
    unitPlural: 'Chapters',
    blocks: ['heading', 'para', 'quote', 'note', 'tk'],
    entities: {
      person: 'People',
      place: 'Places',
      era: 'Eras & timeline',
      event: 'Key events',
      theme: 'Themes',
    },
    arc: ['Before', 'The break', 'The descent', 'The turn', 'The reckoning', 'After'],
    guidance: `This is life writing. Facts matter: keep every name, date, place, and number exactly as spoken. If the speaker contradicts an earlier take (a different year, an age that doesn't add up), add a flag.
Order chapters chronologically by default unless the speaker asks for a frame. Each event entity gets a date or era if one was given.
Keep the speaker's reflection passages intact. Those are the voice of the book.`,
    exports: ['docx', 'scrivener', 'markdown', 'obsidian', 'rtf', 'txt', 'json'],
  },
  essay: {
    label: 'Essay / Substack',
    icon: '✒️',
    unit: 'section',
    unitPlural: 'Sections',
    blocks: ['heading', 'para', 'quote', 'note', 'cite', 'tk'],
    entities: {
      claim: 'Claims',
      image: 'Images & scenes',
      example: 'Examples & stories',
      counter: 'Counterpoints',
    },
    arc: ['Opening scene', 'The question', 'Turn 1', 'Turn 2', 'Complication', 'Landing'],
    guidance: `Shape an essay. The opening section should start in a concrete moment the speaker described, if they described one. Pull out the spine claim and the images that carry it.
Sections are short. Paragraphs 1 to 3 sentences. Keep the speaker's jokes, asides, and hard turns. Mark any factual claim that needs a source with a cite block.`,
    exports: ['docx', 'markdown', 'obsidian', 'rtf', 'txt', 'scrivener', 'json'],
  },
  academic: {
    label: 'Academic paper',
    icon: '🎓',
    unit: 'section',
    unitPlural: 'Sections',
    blocks: ['heading', 'para', 'bullet', 'quote', 'cite', 'note', 'tk'],
    entities: {
      claim: 'Claims & hypotheses',
      evidence: 'Evidence',
      source: 'Sources to cite',
      method: 'Methods',
      term: 'Key terms',
      gap: 'Gaps & limitations',
    },
    arc: ['Introduction', 'Literature review', 'Method', 'Results', 'Discussion', 'Limitations', 'Conclusion'],
    guidance: `Organize into academic sections (use the arc names as section titles unless the speaker gives their own). Every factual or empirical claim the speaker makes without naming a source gets a cite block right after it: "[CITE: claim needing support]".
When the speaker names an author, study, or year, record a source entity with exactly what they said. Never invent a citation, DOI, page number, or year.
Formal register is fine, but keep the speaker's argument order and their own terms.`,
    exports: ['docx', 'markdown', 'obsidian', 'rtf', 'txt', 'scrivener', 'json'],
  },
  research: {
    label: 'Research notes',
    icon: '🔬',
    unit: 'section',
    unitPlural: 'Topics',
    blocks: ['heading', 'para', 'bullet', 'cite', 'note', 'tk'],
    entities: {
      question: 'Open questions',
      finding: 'Findings',
      source: 'Sources',
      idea: 'Ideas',
      todo: 'To do',
    },
    arc: ['Questions', 'What I know', 'What I suspect', 'What to read', 'Next steps'],
    guidance: `Sort the take into topics. Bullets are fine here. Separate what the speaker knows from what they suspect and what they need to look up. Every "I need to check" or "look this up" becomes a todo entity.`,
    exports: ['markdown', 'obsidian', 'docx', 'txt', 'json', 'scrivener'],
  },
  nonfiction: {
    label: 'Nonfiction book',
    icon: '📚',
    unit: 'chapter',
    unitPlural: 'Chapters',
    blocks: ['heading', 'para', 'quote', 'bullet', 'cite', 'note', 'tk'],
    entities: {
      claim: 'Core claims',
      story: 'Stories & case examples',
      concept: 'Concepts & frameworks',
      source: 'Sources',
      person: 'People',
    },
    arc: ['Opening story', 'The problem', 'Why it happens', 'What helps', 'Hard cases', 'Closing image'],
    guidance: `Shape chapters for a trade nonfiction book. Stories and case examples stay as close to the speaker's telling as possible. Concepts get named once and used consistently. Mark claims needing sources with cite blocks.
If a story involves a real client, patient, or identifiable private person, add a note block reminding the author to de-identify it.`,
    exports: ['docx', 'scrivener', 'markdown', 'obsidian', 'rtf', 'txt', 'json'],
  },
  journal: {
    label: 'Journal / brain dump',
    icon: '🌀',
    unit: 'section',
    unitPlural: 'Threads',
    blocks: ['heading', 'para', 'bullet', 'note'],
    entities: {
      thread: 'Recurring threads',
      idea: 'Ideas worth keeping',
      todo: 'To do',
      person: 'People',
    },
    arc: ['Raw', 'Sorted', 'Keepers'],
    guidance: `This is free thought. Group the take into threads by topic. Pull out any idea that could become a piece of writing as an idea entity. Change as little as possible.`,
    exports: ['markdown', 'obsidian', 'docx', 'txt', 'json'],
  },
};

export const EDIT_LEVELS = {
  verbatim: {
    label: 'Verbatim',
    blurb: 'Sort and format only. Every word you said stays.',
    rule: `EDIT LEVEL: VERBATIM. Do not change, add, or remove words except: spoken cue phrases, and pure filler sounds ("um", "uh"). Fix punctuation and capitalization only. Your job is sorting and formatting.`,
  },
  clean: {
    label: 'Clean',
    blurb: 'Cut fillers, false starts, repeats. Keep your words and rhythm.',
    rule: `EDIT LEVEL: CLEAN. Remove fillers (um, uh, like, you know, I mean, sort of, kind of when used as filler), false starts, stutters, and accidental repeats. Fix punctuation and obvious transcription errors. Keep the speaker's word choice, sentence shapes, slang, profanity, and rhythm. Never swap a plain word for a fancier one.`,
  },
  shape: {
    label: 'Shape',
    blurb: 'Tighten and order. Anything the Director adds is marked.',
    rule: `EDIT LEVEL: SHAPE. You may do everything CLEAN allows, plus reorder sentences inside a passage, merge repeated tellings of the same moment into one, and turn retold speech into proper dialogue. Any connective words you must add that the speaker never said go in their own block with origin "bridge", kept as short as possible. Never add an image, fact, feeling, or idea the speaker didn't give you.`,
  },
};

export const kindOf = k => KINDS[k] || KINDS.novel;
