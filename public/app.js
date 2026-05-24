(() => {
  // ── theme picker ─────────────────────────────────────────────
  const THEMES = ['unicorn', 'garden', 'underwater'];
  const applyTheme = (name) => {
    const theme = THEMES.includes(name) ? name : 'unicorn';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch (_) {}
    document.querySelectorAll('.theme-swatch').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.theme === theme ? 'true' : 'false');
    });
  };
  document.querySelectorAll('.theme-swatch').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.theme));
  });
  applyTheme((() => { try { return localStorage.getItem('theme'); } catch (_) { return null; } })());

  // ── element refs ─────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sentenceEl = document.getElementById('sentence');
  const chipsEl = document.getElementById('chips');
  const micEl = document.getElementById('mic');
  const statusEl = document.getElementById('status');
  const overlayEl = document.getElementById('overlay');
  const connectEl = document.getElementById('connect');
  const overlayStatusEl = document.getElementById('overlay-status');

  const PLACEHOLDER = 'Hold the button and say a sentence';

  // ── overlay helpers ──────────────────────────────────────────
  const setOverlayStatus = (msg, isError = false) => {
    overlayStatusEl.textContent = msg || '';
    overlayStatusEl.classList.toggle('error', isError);
  };
  const showOverlay = (msg, isError = false) => {
    overlayEl.hidden = false;
    setOverlayStatus(msg || '', isError);
  };
  const hideOverlay = () => {
    overlayEl.hidden = true;
    setOverlayStatus('');
  };

  if (!SR) {
    showOverlay('This browser does not support speech recognition. Try Chrome, Edge, or Safari.', true);
    connectEl.disabled = true;
    return;
  }

  // ── mic permission flow ──────────────────────────────────────
  const requestMic = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setOverlayStatus('Microphone access not available in this browser.', true);
      return;
    }
    setOverlayStatus('Waiting for permission…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      localStorage.setItem('mic-connected', '1');
      hideOverlay();
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setOverlayStatus('Permission was blocked. Tap the lock icon in the address bar to allow the mic, then reload.', true);
      } else if (err && err.name === 'NotFoundError') {
        setOverlayStatus('No microphone found on this device.', true);
      } else {
        setOverlayStatus('Could not access microphone: ' + (err && err.message ? err.message : 'unknown error'), true);
      }
    }
  };
  connectEl.addEventListener('click', requestMic);

  (async () => {
    let state = null;
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        state = status.state;
        status.onchange = () => {
          if (status.state === 'denied') {
            localStorage.removeItem('mic-connected');
            showOverlay('Microphone access was turned off. Tap Connect when you’re ready.', true);
          }
        };
      } catch (_) { /* browser doesn't support querying 'microphone' */ }
    }
    if (state === 'granted' || (state === null && localStorage.getItem('mic-connected') === '1')) {
      hideOverlay();
    } else {
      showOverlay();
    }
  })();

  // ── state ────────────────────────────────────────────────────
  let recognition = null;
  let holding = false;
  let listening = false;
  let gotResultThisSession = false;

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', isError);
  };

  // ── TTS ──────────────────────────────────────────────────────
  const speak = (text, onEnd) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.85;
    u.pitch = 1.05;
    if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
    window.speechSynthesis.speak(u);
  };

  // queueSpeak: append to TTS queue (doesn't cancel what's playing). Slower rate
  // so spelled-out letters land clearly.
  const queueSpeak = (text, { rate = 0.85, onEnd } = {}) => {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    u.pitch = 1.05;
    if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
    window.speechSynthesis.speak(u);
  };

  // ── sentence + chips ─────────────────────────────────────────
  const spellOf = (word) => {
    // "cat" -> "C... A... T." — ASCII dots + space give TTS a clean pause per letter
    const letters = word.toUpperCase().replace(/[^A-Z]/g, '').split('');
    return letters.length ? letters.join('... ') + '.' : '';
  };

  const showSentence = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return;

    // Display: capitalize first letter, ensure terminal punctuation
    let display = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.!?]$/.test(display)) display += '.';
    sentenceEl.textContent = display;
    sentenceEl.classList.remove('placeholder');

    // Tokenize into chips. Lowercase + strip punctuation so chips read clean.
    chipsEl.innerHTML = '';
    for (const rawWord of text.split(/\s+/)) {
      const clean = rawWord.replace(/[^A-Za-z'\-]/g, '').toLowerCase();
      if (!clean) continue;
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = clean;
      chip.addEventListener('click', () => speakChip(chip, clean));
      chipsEl.appendChild(chip);
    }
    chipsEl.hidden = chipsEl.children.length === 0;
    setStatus(chipsEl.children.length > 1 ? 'Tap a word to spell it' : 'Tap the word to spell it');

    // Read the whole sentence back to the kid
    speak(display);
  };

  const speakChip = (chip, word) => {
    document.querySelectorAll('.chip.speaking').forEach((c) => c.classList.remove('speaking'));
    chip.classList.add('speaking');
    // Speak the word, then queue the spelling. onEnd of the spelling clears the highlight.
    speak(word);
    queueSpeak(spellOf(word), { rate: 0.7, onEnd: () => chip.classList.remove('speaking') });
  };

  // ── SpeechRecognition (disposable; recreated on wedge — see project memory) ──
  const createRecognition = () => {
    const sr = new SR();
    sr.lang = 'en-US';
    sr.continuous = false;
    sr.interimResults = false;
    sr.maxAlternatives = 1;

    sr.onstart = () => { listening = true; setStatus('Listening…'); };

    sr.onresult = (e) => {
      gotResultThisSession = true;
      const result = e.results[0];
      if (result && result[0]) showSentence(result[0].transcript);
    };

    sr.onerror = (e) => {
      listening = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        holding = false;
        micEl.classList.remove('holding');
        localStorage.removeItem('mic-connected');
        showOverlay('Microphone is blocked. Tap Connect to allow it again.', true);
        recognition = null;
      } else if (e.error === 'no-speech') {
        setStatus('Didn’t hear anything — hold the button while you speak');
      } else if (e.error === 'aborted') {
        // benign — usually user released early
      } else {
        setStatus('SR error: ' + e.error, true);
        recognition = null;
      }
    };

    sr.onend = () => {
      listening = false;
      if (holding && !gotResultThisSession) {
        try { sr.start(); } catch (_) { recognition = null; }
        return;
      }
      micEl.classList.remove('holding');
      // If session ended with no result and no other status set, give the kid a hint.
      if (!gotResultThisSession && statusEl.textContent === 'Listening…') {
        setStatus('Didn’t hear anything — hold the button while you speak');
      }
    };

    return sr;
  };

  const startListening = () => {
    if (listening) return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    gotResultThisSession = false;
    if (!recognition) recognition = createRecognition();
    try {
      recognition.start();
    } catch (_) {
      recognition = createRecognition();
      try { recognition.start(); }
      catch (__) {
        listening = false;
        holding = false;
        micEl.classList.remove('holding');
        setStatus('Tap the mic to try again', true);
      }
    }
  };

  const stopListening = () => {
    if (!recognition) return;
    try { recognition.stop(); } catch (_) {}
  };

  // ── mic press/release ────────────────────────────────────────
  const onPress = (e) => {
    e.preventDefault();
    if (holding) return;
    holding = true;
    micEl.classList.add('holding');
    if (e.pointerId !== undefined && micEl.setPointerCapture) {
      try { micEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (navigator.vibrate) navigator.vibrate(15);
    startListening();
  };

  const onRelease = (e) => {
    if (e) e.preventDefault();
    if (!holding) return;
    holding = false;
    stopListening();
  };

  micEl.addEventListener('pointerdown', onPress);
  micEl.addEventListener('pointerup', onRelease);
  micEl.addEventListener('pointercancel', onRelease);
  micEl.addEventListener('contextmenu', (e) => e.preventDefault());
  micEl.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) onPress(e);
  });
  micEl.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') onRelease(e);
  });

  // ── reset button ─────────────────────────────────────────────
  document.getElementById('reset').addEventListener('click', () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    holding = false;
    listening = false;
    gotResultThisSession = false;
    micEl.classList.remove('holding');
    sentenceEl.textContent = PLACEHOLDER;
    sentenceEl.classList.add('placeholder');
    chipsEl.innerHTML = '';
    chipsEl.hidden = true;
    setStatus('');
  });

  // ── service worker ───────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();
