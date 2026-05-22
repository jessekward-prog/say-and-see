(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const wordEl = document.getElementById('word');
  const sentenceEl = document.getElementById('sentence');
  const variantsEl = document.getElementById('variants');
  const micEl = document.getElementById('mic');
  const statusEl = document.getElementById('status');
  const overlayEl = document.getElementById('overlay');
  const connectEl = document.getElementById('connect');
  const overlayStatusEl = document.getElementById('overlay-status');

  const HOMOPHONES = buildHomophones();

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
  let gotResultThisSession = false;

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', isError);
  };

  const normalize = (raw) => {
    if (!raw) return '';
    const first = raw.trim().split(/\s+/)[0] || '';
    return first.replace(/[.,!?;:"]/g, '').toLowerCase();
  };

  const showWord = (raw) => {
    const word = normalize(raw);
    if (!word) return;
    wordEl.textContent = word;
    wordEl.classList.remove('placeholder');
    const group = HOMOPHONES[word];
    if (group && group.length > 1) {
      renderVariants(word, group);
    } else {
      clearVariants();
    }
    setStatus('Tap the word to hear it');
    speak(word);
  };

  const renderVariants = (current, group) => {
    variantsEl.innerHTML = '';
    const me = group.find((v) => v.word.toLowerCase() === current);
    if (me && me.sentence) {
      sentenceEl.textContent = me.sentence;
      sentenceEl.hidden = false;
    } else {
      sentenceEl.hidden = true;
    }
    let any = false;
    for (const v of group) {
      if (v.word.toLowerCase() === current) continue;
      any = true;
      const li = document.createElement('li');
      li.className = 'variant';
      li.setAttribute('role', 'button');
      li.tabIndex = 0;

      const w = document.createElement('span');
      w.className = 'variant-word';
      w.textContent = v.word;

      const s = document.createElement('span');
      s.className = 'variant-sentence';
      s.textContent = v.sentence;

      li.appendChild(w);
      li.appendChild(s);
      const activate = () => {
        const next = v.word.toLowerCase();
        wordEl.textContent = next;
        renderVariants(next, group);
        speak(v.word);
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
      });
      variantsEl.appendChild(li);
    }
    variantsEl.hidden = !any;
  };

  const clearVariants = () => {
    variantsEl.innerHTML = '';
    variantsEl.hidden = true;
    sentenceEl.hidden = true;
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
    gotResultThisSession = true;
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
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      setStatus('SR error: ' + e.error, true);
    }
  };

  recognition.onend = () => {
    listening = false;
    // Restart only if user is STILL holding AND we haven't already produced a result this session.
    // Without this guard, a successful result + still-pressed finger would race the user's release
    // and leave the recognizer in a half-restarted state — breaking the next press.
    if (holding && !gotResultThisSession) {
      try { recognition.start(); } catch (_) {}
    } else {
      micEl.classList.remove('holding');
    }
  };

  const startListening = () => {
    if (listening) return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    gotResultThisSession = false;
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

  function buildHomophones() {
    const groups = [
      [['there', 'The cat is over there.'], ['their', 'It is their cat.'], ["they're", "They're playing outside."]],
      [['to', 'I go to school.'], ['too', 'I want one too.'], ['two', 'I have two cats.']],
      [['your', 'Is that your bag?'], ["you're", "You're so kind."]],
      [['here', 'Come here, please.'], ['hear', 'I can hear the music.']],
      [['right', 'Turn right at the corner.'], ['write', 'Write your name on the page.']],
      [['bare', 'My feet are bare.'], ['bear', 'The bear walked through the woods.']],
      [['be', 'I want to be a doctor.'], ['bee', 'A bee landed on the flower.']],
      [['blew', 'The wind blew the leaves.'], ['blue', 'The sky is blue.']],
      [['by', 'Sit by the window.'], ['buy', 'I want to buy a toy.'], ['bye', 'Wave bye to grandma.']],
      [['cent', 'A penny is one cent.'], ['sent', 'I sent her a letter.'], ['scent', 'I love the scent of flowers.']],
      [['dear', 'Hello, my dear friend.'], ['deer', 'A deer ran across the road.']],
      [['fair', 'That is not fair.'], ['fare', 'The bus fare is two dollars.']],
      [['flour', 'We need flour to bake bread.'], ['flower', 'A pretty flower in the garden.']],
      [['for', 'This gift is for you.'], ['four', 'I have four apples.']],
      [['hair', 'Brush your hair before school.'], ['hare', 'A hare hops very fast.']],
      [['heal', 'The cut will heal soon.'], ['heel', 'I hurt my heel running.']],
      [['hour', 'Bed time in one hour.'], ['our', 'This is our house.']],
      [['knew', 'I knew the answer.'], ['new', 'I have new shoes.']],
      [['knight', 'The knight had a shiny sword.'], ['night', 'It is dark at night.']],
      [['know', 'I know the song.'], ['no', 'No, thank you.']],
      [['mail', 'The mail is in the box.'], ['male', 'A male lion has a mane.']],
      [['meet', 'Let us meet at the park.'], ['meat', 'I eat meat for dinner.']],
      [['one', 'I have one cat.'], ['won', 'She won the race.']],
      [['pair', 'I bought a pair of socks.'], ['pear', 'A pear is a sweet fruit.']],
      [['peace', 'Please give me some peace.'], ['piece', 'May I have a piece of cake?']],
      [['plain', 'The shirt is plain white.'], ['plane', 'A plane flies high in the sky.']],
      [['rain', 'It will rain today.'], ['reign', 'The queen began her reign.']],
      [['read', 'I love to read books.'], ['red', 'The apple is red.']],
      [['road', 'Be careful by the road.'], ['rode', 'I rode my bike to school.']],
      [['sea', 'Fish swim in the sea.'], ['see', 'I can see the moon.']],
      [['son', 'She has one son.'], ['sun', 'The sun is bright and hot.']],
      [['tail', 'The dog wagged its tail.'], ['tale', 'Tell me a bedtime tale.']],
      [['threw', 'He threw the ball.'], ['through', 'I walked through the door.']],
      [['wait', 'Please wait for me.'], ['weight', 'The weight of the box is heavy.']],
      [['way', 'Which way is the park?'], ['weigh', 'I will weigh the apples.']],
      [['weak', 'I feel weak today.'], ['week', 'A week has seven days.']],
      [['which', 'Which one is yours?'], ['witch', 'The witch wore a black hat.']],
      [['wood', 'The chair is made of wood.'], ['would', 'I would like cake, please.']],
      [['ate', 'I ate my breakfast.'], ['eight', 'There are eight days left.']],
      [['hi', 'Hi, how are you?'], ['high', 'The kite flew very high.']],
      [['toe', 'I stubbed my toe.'], ['tow', 'The truck will tow the car.']]
    ];
    const dict = {};
    for (const group of groups) {
      const entries = group.map(([word, sentence]) => ({ word, sentence }));
      for (const entry of entries) {
        dict[entry.word.toLowerCase()] = entries;
      }
    }
    return dict;
  }
})();
