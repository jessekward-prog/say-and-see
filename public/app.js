(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const wordEl = document.getElementById('word');
  const micEl = document.getElementById('mic');
  const statusEl = document.getElementById('status');
  const overlayEl = document.getElementById('overlay');
  const connectEl = document.getElementById('connect');
  const overlayStatusEl = document.getElementById('overlay-status');

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

  const recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let holding = false;
  let listening = false;

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', isError);
  };

  const showWord = (raw) => {
    if (!raw) return;
    const word = raw.trim().split(/\s+/)[0].replace(/[.,!?;:"']/g, '').toLowerCase();
    if (!word) return;
    wordEl.textContent = word;
    wordEl.classList.remove('placeholder');
    setStatus('Tap the word to hear it');
    speak(word);
  };

  const speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.85;
    u.pitch = 1.05;
    wordEl.classList.add('speaking');
    u.onend = () => wordEl.classList.remove('speaking');
    u.onerror = () => wordEl.classList.remove('speaking');
    window.speechSynthesis.speak(u);
  };

  recognition.onstart = () => {
    listening = true;
    setStatus('Listening…');
  };

  recognition.onresult = (e) => {
    const result = e.results[0];
    if (result && result[0]) showWord(result[0].transcript);
  };

  recognition.onerror = (e) => {
    listening = false;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      holding = false;
      micEl.classList.remove('holding');
      localStorage.removeItem('mic-connected');
      showOverlay('Microphone is blocked. Tap Connect to allow it again.', true);
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // benign — keep button green while finger is still down; onend will decide whether to restart
    } else {
      setStatus('Error: ' + e.error, true);
    }
  };

  recognition.onend = () => {
    listening = false;
    if (holding) {
      // user is still pressing — restart so a long hold keeps listening across SR's auto-end
      try { recognition.start(); } catch (_) {}
    } else {
      micEl.classList.remove('holding');
    }
  };

  const startListening = () => {
    if (listening) return;
    try {
      recognition.start();
    } catch (_) { /* already started */ }
  };

  const stopListening = () => {
    if (!listening) return;
    try { recognition.stop(); } catch (_) {}
  };

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

  wordEl.addEventListener('click', () => {
    if (wordEl.classList.contains('placeholder')) return;
    speak(wordEl.textContent);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();
