# Voice Director

Talk into your iPhone. Get a structured draft back, in your own words.

Pick a project type (screenplay, novel, memoir, essay/Substack, academic paper, research notes, nonfiction book, or journal), then record a take: a scene you're picturing, a story you're retelling, an argument you're circling. The Director sorts it into scenes, chapters, or sections, builds a bible of your characters, places, claims, and sources, maps it onto a story structure, and asks you the questions a good editor would. Then you export it to Word, Scrivener, Final Draft, Fountain, Obsidian, Markdown, RTF, or JSON.

It runs as a home-screen web app, the same way Ghostwriter does. No App Store, no Xcode.

## Put it on your iPhone

1. **Turn on GitHub Pages** for this repo: GitHub → Settings → Pages → Source: *Deploy from a branch* → pick the branch with this code (`main` once merged, or `claude/magical-curie-uqtycm` now) and `/ (root)` → Save. After a minute your app is at `https://seany420.github.io/voice-director/`.
2. Open that link in **Safari** on your iPhone.
3. Tap **Share → Add to Home Screen**. Open it from the icon from now on. (Home-screen apps keep their storage; a plain Safari tab can get cleared by iOS after a week of no use.)
4. Tap ⚙︎ and paste your Anthropic API key (console.anthropic.com → API Keys). Tap **Test key**.
5. The first time you hit record, allow the microphone and speech recognition.

## How a take works

1. **Record.** Three ways in:
   - **Live**: tap the red button and talk. It keeps listening through pauses (iOS stops speech recognition every minute or so; the app restarts it and keeps every word).
   - **Type**: tap the text box and use the mic on your iPhone keyboard. iOS keyboard dictation is very good at punctuation, so use it for long, careful takes.
   - **Paste**: drop in a Voice Memos transcript or notes from anywhere.
2. **Fix anything** in the text box if you want, then **Save & direct**.
3. The Director places it. A take can continue a scene from yesterday, start 3 new ones, and add a character to the bible, all at once.

Unsaved takes autosave every few seconds, so a phone call won't eat one.

### Cue words

Say these while talking:

| Say | Get |
|---|---|
| "new scene" / "new chapter" / "new section" | a new unit starts here |
| "scratch that" | the sentence you just said is dropped |
| "note to self …" | a margin note, never prose |
| "verbatim … end verbatim" | exact words, never edited |
| "character note" / "setting note" / "idea note" / "source note" | bible material |
| "new paragraph" | paragraph break |

## Keeping your voice

This is the part that matters most, so it has its own tab.

- **Edit levels** per project. *Verbatim*: sorting and formatting only. *Clean* (default): cuts ums, false starts, repeats; keeps your words and rhythm. *Shape*: tightens and reorders, and any word the Director adds shows up **blue** so you can see it and kill it.
- **Never invents.** When something is missing (a location, a year, how she got to the hospital) the Director leaves a yellow **TK** instead of making it up. Academic and nonfiction modes add `[CITE]` flags instead of inventing sources.
- **"Your words" score** on every scene and on the whole draft: the share of the draft that's traceable, word for word, to what you said out loud. Computed on the phone, no AI.
- **Voice Guard** flags em dashes, negative parallelisms ("it's not X, it's Y"), banned words (delve, leverage, tapestry…), banned phrases, lists of exactly 3, and flat sentence rhythm. It's preloaded with your rules; edit them on the Voice tab. One tap fixes every em dash.
- **Fingerprint**: paste or upload pieces you've written. The app measures your sentence length and spread, fragments, contractions, paragraph length, punctuation habits, and the words you lean on, and the Director matches them when it cleans up your speech.

## Exports

| Format | Good for |
|---|---|
| Word (.docx) | Word, Pages, Google Docs. Manuscript format for prose (12pt, double-spaced, header with name/title/page); industry layout for screenplays |
| Scrivener bundle (.zip) | One RTF per scene in order, the bible as research docs, raw takes, and an OPML binder. Import steps are inside |
| Fountain | Highland, Fade In, WriterSolo, Final Draft, Scrivener screenwriting mode |
| Final Draft (.fdx) | Final Draft 8+ |
| Markdown | Obsidian, Ulysses, iA Writer, Bear, Notion |
| Obsidian vault (.zip) | The draft plus one linked note per character, place, idea, and take |
| RTF, OPML, plain text | Opens anywhere. Plain text uses `#` breaks for Scrivener's Import and Split |
| JSON | The full project: backup, or hand it to your writing room app |
| Print / PDF | Opens the print sheet |

Files go through the iOS share sheet: Save to Files, AirDrop to your Mac, or straight into an app.

## Privacy

Projects, takes, audio, and your writing samples live on your phone (IndexedDB). The only thing that leaves is the text of a take plus project context, sent to Anthropic when you direct it. Your API key is stored on the phone and sent only to Anthropic.

## Under the hood

- Plain HTML/CSS/JS modules, no build step. The only third-party code is the official Anthropic SDK, bundled into `vendor/anthropic.mjs` (`npm run build:vendor` to refresh it).
- Each take is one streaming call to Claude Opus 5.5 (switchable to Sonnet 5.5 or Fable 5.1 in Settings) with adaptive thinking, a schema-constrained JSON response, prompt caching on the system prompt, and automatic fallback if a take is declined.
- Works offline for everything except directing (service worker).
- `npm test` runs the unit tests (cue parsing, Voice Guard, merging, the Claude request shape against a mocked stream, every export format, XML validity). `node tests/e2e.mjs` drives the whole app in a phone-sized browser with Claude and speech recognition faked.

| File | What it does |
|---|---|
| `js/kinds.js` | Project types: what to extract, structure beats, edit levels |
| `js/cues.js` | Spoken cue parsing |
| `js/director.js` | Prompts, output schema, Claude calls |
| `js/model.js` | Project data and the merge that folds each take in |
| `js/voiceguard.js` | AI-tell linter, fingerprint, "your words" score |
| `js/recorder.js` | Live dictation with auto-restart, optional audio copy |
| `js/export/` | Every export format, including a hand-built .docx and zip writer |
| `js/main.js` | The interface |

## Limits worth knowing

- Live dictation stops when the screen locks or you switch apps (an iOS rule for web apps). The app holds the screen awake while recording. For long walks, use iOS Voice Memos and paste the transcript.
- "Keep an audio copy" is off by default because some iOS versions won't let a web app record audio and run speech recognition at the same time. If yours won't, the app turns it off and keeps the words.
- Directing needs a signal. Takes save offline and wait.
