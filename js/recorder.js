// Live dictation on iPhone Safari. Speech recognition stops on its own after
// silences or about a minute, so this quietly restarts it until you hit stop,
// and keeps every word it heard across restarts.

export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export class Dictation {
  constructor({ lang = 'en-US', keepAudio = false, onText, onState, onLevel, onError } = {}) {
    Object.assign(this, { lang, keepAudio, onText, onState, onLevel, onError });
    this.committed = '';
    this.session = [];
    this.active = false;
    this.rec = null;
    this.media = null;
    this.chunks = [];
    this.stream = null;
    this.startedAt = 0;
    this.elapsed = 0;
    this.wake = null;
    this.restarts = 0;
  }

  get text() {
    return (this.committed + ' ' + this.session.join(' ')).replace(/\s+/g, ' ').trim();
  }

  get seconds() {
    return Math.round((this.elapsed + (this.active ? Date.now() - this.startedAt : 0)) / 1000);
  }

  /** Seed with existing text so "continue recording" appends. */
  seed(text) { this.committed = text || ''; }

  async start() {
    if (this.active) return;
    if (!speechSupported()) throw new Error('Live dictation needs Safari on iPhone (iOS 14.5+). Use the keyboard mic in Type mode instead.');
    this.active = true;
    this.startedAt = Date.now();
    this.onState?.('starting');
    if (this.keepAudio) await this._startAudio().catch(err => {
      this.keepAudio = false;
      this.onError?.('Audio copy is off: ' + (err.message || err) + '. Dictation still works.');
    });
    this._lock();
    this._listen();
    document.addEventListener('visibilitychange', this._vis = () => { if (document.visibilityState === 'visible' && this.active) this._lock(); });
  }

  _listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    this.session = [];
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) this.session[i] = e.results[i][0].transcript;
      this.onText?.(this.text);
    };
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.onError?.('Microphone or speech recognition is blocked. On iPhone: Settings > Apps > Safari > Microphone, and Settings > Privacy > Speech Recognition.');
        this.stop();
        return;
      }
      if (e.error === 'audio-capture' && this.media) {
        // The mic is shared badly on some iOS versions. Drop the audio copy, keep the words.
        this._stopAudio(true);
        this.onError?.('iOS would not share the mic between recording and dictation, so the audio copy is off for this take.');
        return;
      }
      this.onError?.('Dictation hiccup: ' + e.error + '. Still listening.');
    };
    r.onend = () => {
      // Commit everything this session heard, final or not. iOS often never marks results final.
      const heard = this.session.join(' ').trim();
      if (heard) this.committed = (this.committed + ' ' + heard).trim();
      this.session = [];
      if (this.active) {
        this.restarts++;
        setTimeout(() => this.active && this._listen(), 200);
      } else {
        this.onText?.(this.text);
      }
    };
    r.onstart = () => this.onState?.('listening');
    try { r.start(); } catch (err) { this.onError?.(err.message); }
    this.rec = r;
  }

  async _startAudio() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    this.media = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.media.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.media.start(1000);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(this.stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!this.stream) { ctx.close(); return; }
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        this.onLevel?.(peak / 128);
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* meter is optional */ }
  }

  _stopAudio(discard = false) {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (discard) { this.media = null; this.chunks = []; }
  }

  async _lock() {
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
  }

  /** Stops and resolves {text, seconds, audio: Blob|null, mime} */
  async stop() {
    if (!this.active) return { text: this.text, seconds: this.seconds, audio: null };
    this.active = false;
    this.elapsed += Date.now() - this.startedAt;
    document.removeEventListener('visibilitychange', this._vis);
    try { this.rec?.stop(); } catch { /* already stopped */ }
    try { await this.wake?.release(); } catch { /* fine */ }
    let audio = null, mime = '';
    if (this.media) {
      const m = this.media;
      await new Promise(res => { m.onstop = res; if (m.state === 'inactive') res(); else m.stop(); });
      mime = m.mimeType || 'audio/mp4';
      audio = this.chunks.length ? new Blob(this.chunks, { type: mime }) : null;
    }
    this._stopAudio();
    this.media = null;
    // Give the recognizer a beat to flush its last words.
    await new Promise(r => setTimeout(r, 350));
    const heard = this.session.join(' ').trim();
    if (heard) { this.committed = (this.committed + ' ' + heard).trim(); this.session = []; }
    this.onState?.('stopped');
    return { text: this.text, seconds: this.seconds, audio, mime };
  }
}
