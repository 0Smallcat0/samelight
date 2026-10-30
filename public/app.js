/* SameLight page: photo intake, live analysis, and the result slip. */
(() => {
  const $ = id => document.getElementById(id);
  const slots = { before: null, after: null };
  let current = null;
  let view = 'shown';

  const say = text => { $('status').textContent = text; };
  const signed = n => {
    const whole = Math.round(n);
    return whole === 0 ? '0' : `${whole > 0 ? '+' : '−'}${Math.abs(whole)}`;
  };
  const nextPaint = () => new Promise(r => setTimeout(r, 30));

  function setSlot(slot, canvas) {
    slots[slot] = canvas;
    const box = document.querySelector(`[data-slot="${slot}"]`);
    const shown = box.querySelector('canvas');
    shown.width = canvas.width; shown.height = canvas.height;
    shown.getContext('2d').drawImage(canvas, 0, 0);
    shown.hidden = false;
    box.querySelector('.drop-hint').hidden = true;
    $('run').disabled = !(slots.before && slots.after);
  }

  async function canvasFrom(file) {
    const bitmap = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    return c;
  }

  async function takeScreenshot(file) {
    say('Reading the screenshot…');
    await SameLight.load();
    const pair = SameLight.splitPair(await canvasFrom(file));
    if (!pair) return say('That image needs to show exactly two faces.');
    setSlot('before', pair[0]);
    setSlot('after', pair[1]);
    say('Found both faces. Check that the order is right.');
  }

  document.querySelectorAll('.drop').forEach(box => {
    const slot = box.dataset.slot;
    box.querySelector('input').addEventListener('change', async e => {
      if (e.target.files[0]) setSlot(slot, await canvasFrom(e.target.files[0]));
    });
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', async e => {
      e.preventDefault();
      box.classList.remove('over');
      if (e.dataTransfer.files[0]) setSlot(slot, await canvasFrom(e.dataTransfer.files[0]));
    });
  });

  document.addEventListener('paste', e => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (item) takeScreenshot(item.getAsFile());
  });

  async function analyze(blob) {
    const start = await fetch('/api/analyze', { method: 'POST', body: blob });
    const made = await start.json();
    if (start.status === 429) throw new Error('Live checks are paused right now. The examples below still work.');
    if (!start.ok) throw new Error(made.error || 'The analysis did not start.');
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const state = await (await fetch(`/api/task?id=${made.id}`)).json();
      if (state.status === 'done') return state.scores;
      if (state.status === 'error') throw new Error('YouCam could not read this photo. Use a larger image with the whole face showing.');
    }
    throw new Error('The analysis took too long. Please try again.');
  }

  async function runCheck() {
    $('run').disabled = true;
    try {
      say('Loading the face model…');
      await nextPaint();
      await SameLight.load();
      say('Matching focus, exposure and colour…');
      await nextPaint();
      const p = await SameLight.prepare(slots.before, slots.after);
      say('Measuring four photos with YouCam Skin Analysis…');
      const [shownBefore, shownAfter, fairBefore, fairAfter] = await Promise.all(
        ['shownBefore', 'shownAfter', 'fairBefore', 'fairAfter'].map(k => analyze(p.blobs[k])));
      render({
        scores: { shownBefore, shownAfter, fairBefore, fairAfter },
        facts: p.facts,
        images: {
          shownBefore: URL.createObjectURL(p.blobs.shownBefore), shownAfter: URL.createObjectURL(p.blobs.shownAfter),
          fairBefore: URL.createObjectURL(p.blobs.fairBefore), fairAfter: URL.createObjectURL(p.blobs.fairAfter),
        },
      });
      say('');
    } catch (err) {
      say(err.message);
    }
    $('run').disabled = false;
  }
  $('run').addEventListener('click', runCheck);

  const WORDS = {
    camera: {
      head: 'Mostly the camera.', seal: 'CAMERA',
      text: p => `Only ${p}% of this improvement is still there once both photos share the same focus, exposure and colour.`,
      steps: [
        'Do not count this image as proof. It tells you about the photo, not the product.',
        'Ask the seller for both originals, taken with the same camera, distance and light.',
        'Decide on the ingredients and on reviews with unedited photos.',
      ],
    },
    partly: {
      head: 'Part camera, part skin.', seal: 'MIXED',
      text: p => `${p}% of this improvement holds under the same light. The rest came from how the photos were taken.`,
      steps: [
        'Expect the same-light column, not the ad.',
        'Pay for the measures that held. Ignore the ones that fell away.',
        'Check your own skin below, to see if those measures are where you need help.',
      ],
    },
    skin: {
      head: 'Not explained by the camera.', seal: 'SKIN',
      text: p => `${p}% of this improvement holds under the same light. The photo itself is not what makes this skin look better.`,
      steps: [
        'This ad passes the camera check. Move on to price and ingredients.',
        'Results shown are one person over an unknown time. Ask how long the routine took.',
        'Check your own skin below, to see if the claim fits what you need.',
      ],
    },
    none: {
      head: 'No clear claim to test.', seal: 'NONE',
      text: () => 'These two photos show almost no change in skin scores, as published or under the same light.',
      steps: ['Look for evidence elsewhere. This pair of photos does not make a claim to check.'],
    },
  };

  function factLines(f) {
    const lines = [];
    lines.push(['Focus', f.softer === 'neither' ? 'Matches' : `${f.softer === 'after' ? 'After' : 'Before'} photo is ${f.softnessRatio.toFixed(1)}× softer`]);
    if (f.sceneChanged) lines.push(['Light', 'Lighting differs too much to correct']);
    else {
      const e = Math.round(f.exposure * 100);
      lines.push(['Exposure', Math.abs(e) < 3 ? 'Matches' : `After photo is ${Math.abs(e)}% ${e > 0 ? 'brighter' : 'darker'}`]);
      lines.push(['Colour', Math.abs(f.warmth) < 0.03 ? 'Matches' : `After photo is ${f.warmth > 0 ? 'warmer' : 'cooler'}`]);
    }
    const s = Math.round((f.scale - 1) * 100);
    lines.push(['Framing', Math.abs(s) < 5 ? 'Matches' : `Face is ${Math.abs(s)}% ${s > 0 ? 'larger' : 'smaller'} in the after photo`]);
    if (f.turn > 0.06) lines.push(['Angle', 'Head is turned differently']);
    return lines;
  }

  function setView(next) {
    view = next;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === next));
    $('img-before').src = current.images[`${next}Before`];
    $('img-after').src = current.images[`${next}After`];
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function wipe() {
    const v = $('wipe').value;
    $('img-after').style.clipPath = `inset(0 0 0 ${v}%)`;
    $('divider').style.left = `${v}%`;
  }
  $('wipe').addEventListener('input', wipe);

  function render(result) {
    current = result;
    const s = result.scores;
    const v = SameLight.verdict(s.shownBefore, s.shownAfter, s.fairBefore, s.fairAfter);
    const w = WORDS[v.band], pct = Math.round(v.share * 100);
    $('headline').textContent = w.head;
    $('seal').textContent = w.seal;
    $('explain').textContent = w.text(pct);
    $('sum-shown').textContent = `${signed(v.claimed)} pts`;
    $('sum-fair').textContent = `${signed(v.kept)} pts`;
    $('sum-share').textContent = `${pct}%`;
    $('rows').replaceChildren(...v.rows.map(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.label}</td><td class="r">${signed(r.shown)}</td><td class="r">${signed(r.fair)}</td>`;
      return tr;
    }));
    $('facts').replaceChildren(...factLines(result.facts).flatMap(([k, t]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = t;
      return [dt, dd];
    }));
    $('steps').replaceChildren(...w.steps.map(t => Object.assign(document.createElement('li'), { textContent: t })));
    $('selfie-table').hidden = true;
    $('selfie-status').textContent = '';
    $('slip').hidden = false;
    setView('fair');
    wipe();
    $('slip').scrollIntoView({ behavior: 'smooth' });
  }

  $('selfie').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('selfie-status');
    try {
      status.textContent = 'Measuring your skin…';
      const c = await canvasFrom(file);
      const scale = Math.min(1, 1600 / Math.max(c.width, c.height));
      const small = document.createElement('canvas');
      small.width = c.width * scale; small.height = c.height * scale;
      small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
      const blob = await new Promise(r => small.toBlob(r, 'image/jpeg', 0.92));
      const you = await analyze(blob);
      const s = current.scores;
      const rows = SameLight.verdict(s.shownBefore, s.shownAfter, s.fairBefore, s.fairAfter).rows;
      $('selfie-rows').replaceChildren(...rows.filter(r => r.key in you).map(r => {
        // A sharp selfie is only fair against a sharp photo: the ad's own start plus what really held.
        const end = s.shownBefore[r.key] + r.kept;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.label}</td><td class="r">${you[r.key].toFixed(0)}</td><td class="r">${end.toFixed(0)}</td><td>${you[r.key] >= end ? 'Already there' : 'Room to improve'}</td>`;
        return tr;
      }));
      $('selfie-table').hidden = false;
      status.textContent = '';
    } catch (err) {
      status.textContent = err.message;
    }
    e.target.value = '';
  });

  async function openExample(id) {
    const base = `examples/${id}/`;
    const data = await (await fetch(`${base}result.json`)).json();
    render({
      scores: data.scores, facts: data.facts,
      images: Object.fromEntries(['shownBefore', 'shownAfter', 'fairBefore', 'fairAfter'].map(k => [k, `${base}${k}.jpg`])),
    });
  }

  async function boot() {
    const list = await (await fetch('examples/index.json')).json();
    $('examples').replaceChildren(...list.examples.map(x => {
      const b = document.createElement('button');
      b.className = 'example';
      b.innerHTML = `<img src="examples/${x.id}/shownBefore.jpg" alt=""><img src="examples/${x.id}/shownAfter.jpg" alt=""><span>${x.title}</span>`;
      b.addEventListener('click', () => openExample(x.id));
      return b;
    }));
    $('study').innerHTML = `<thead><tr><th>Test</th><th class="r">Pairs</th><th class="r">Shown</th><th class="r">Left</th></tr></thead><tbody>${
      list.study.map(r => `<tr><td>${r.name}</td><td class="r">${r.pairs}</td><td class="r">${r.shown}</td><td class="r">${r.left}</td></tr>`).join('')}</tbody>`;
    const wanted = new URLSearchParams(location.search).get('example');
    if (wanted) openExample(wanted);
  }
  boot();
})();
