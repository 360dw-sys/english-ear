// English Ear: тренажёр восприятия живой английской речи на слух (6 уровней)
(function () {
  "use strict";

  // ---------- хранилище ----------
  const KEY = "ee_state_v1";
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  const state = Object.assign({ progress: {}, custom: [], days: [] }, load());
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function prog(id) {
    if (!state.progress[id]) state.progress[id] = { done: {}, shadow: 0 };
    return state.progress[id];
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function markDay() {
    const t = today();
    if (!state.days.includes(t)) state.days.push(t);
    save();
    renderStreak();
  }
  function streak() {
    let n = 0;
    const d = new Date();
    for (;;) {
      const s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      if (state.days.includes(s)) { n++; d.setDate(d.getDate() - 1); }
      else if (n === 0 && s === today()) { d.setDate(d.getDate() - 1); }
      else break;
    }
    return n;
  }
  function renderStreak() {
    const n = streak();
    document.getElementById("streak").textContent = n ? "серия: " + n + " дн." : "";
  }

  // ---------- данные ----------
  let clips = [];
  async function loadClips() {
    let remote = [];
    try {
      const r = await fetch("clips.json?ts=" + Date.now(), { cache: "no-store" });
      remote = (await r.json()).clips || [];
    } catch (e) {
      try { remote = JSON.parse(localStorage.getItem("ee_clips_cache") || "[]"); } catch (_) {}
    }
    try { localStorage.setItem("ee_clips_cache", JSON.stringify(remote)); } catch (e) {}
    clips = remote.concat(state.custom || []);
    clips.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  // ---------- утилиты ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(t) {
    t = Math.max(0, Math.round(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function words(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/won't/g, "will not").replace(/can't/g, "can not").replace(/cannot/g, "can not")
      .replace(/n't\b/g, " not").replace(/'re\b/g, " are").replace(/'s\b/g, " is")
      .replace(/'m\b/g, " am").replace(/'ll\b/g, " will").replace(/'ve\b/g, " have").replace(/'d\b/g, " would")
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }
  // сверка диктанта с эталоном: наибольшая общая подпоследовательность слов
  function compare(ref, mine) {
    const a = words(ref), b = words(mine);
    const n = a.length, m = b.length;
    if (!n) return { pct: 0, html: "" };
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(n).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { hit[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const ok = hit.filter(Boolean).length;
    const html = a.map((w, k) => '<span class="' + (hit[k] ? "ok" : "miss") + '">' + esc(w) + "</span>").join(" ");
    return { pct: Math.round((ok / n) * 100), html: html };
  }

  // ---------- плеер YouTube ----------
  let ytReady = false;
  const ytQueue = [];
  window.onYouTubeIframeAPIReady = function () { ytReady = true; ytQueue.splice(0).forEach(f => f()); };
  function whenYT(f) { ytReady && window.YT && YT.Player ? f() : ytQueue.push(f); }

  let player = null, playerReady = false, stopAt = null, onStop = null, poll = null;
  function mountPlayer(el, clip) {
    if (poll) clearInterval(poll);
    player = null; playerReady = false;
    whenYT(function () {
      player = new YT.Player(el, {
        videoId: clip.videoId,
        playerVars: { start: clip.start, end: clip.end, playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0 },
        events: {
          onReady: function () { playerReady = true; },
          onError: function (e) {
            const box = document.getElementById("yt-err");
            if (!box) return;
            const why = (e.data === 101 || e.data === 150) ? "Автор запретил показ этого видео внутри других сайтов." : "YouTube не нашёл это видео или оно закрыто.";
            box.innerHTML = '<div class="hint">' + why + ' Можно открыть его в YouTube на нужной секунде или заменить отрывок во вкладке «Отрывки».</div>' +
              '<a class="ytlink" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + encodeURIComponent(clip.videoId) + '&t=' + clip.start + 's">Открыть в YouTube с ' + Math.floor(clip.start / 60) + ':' + String(clip.start % 60).padStart(2, "0") + '</a>';
          }
        }
      });
      poll = setInterval(function () {
        if (!player || !playerReady || stopAt == null) return;
        const t = player.getCurrentTime();
        if (t >= stopAt) {
          player.pauseVideo();
          stopAt = null;
          const cb = onStop; onStop = null;
          if (cb) cb();
        }
      }, 100);
    });
  }
  let audioEl = null, audioStop = null;
  function mountAudio(clip) {
    if (poll) clearInterval(poll);
    player = null; playerReady = false;
    audioEl = new Audio(clip.audio);
    audioEl.preload = "auto";
    audioEl.addEventListener("timeupdate", function () {
      if (audioStop != null && audioEl.currentTime >= audioStop) {
        audioEl.pause(); audioStop = null;
        const cb = onStop; onStop = null; if (cb) cb();
      }
    });
    audioEl.addEventListener("ended", function () {
      audioStop = null; const cb = onStop; onStop = null; if (cb) cb();
    });
  }
  function playRange(a, b, rate, done) {
    if (current && current.audio && audioEl) {
      audioEl.pause();
      audioEl.playbackRate = rate || 1;
      audioStop = b; onStop = done || null;
      const go = function () {
        try { audioEl.currentTime = a; } catch (e) {}
        const pr = audioEl.play();
        if (pr && pr.catch) pr.catch(function () {});
      };
      if (audioEl.readyState >= 1) go();
      else { audioEl.addEventListener("loadedmetadata", go, { once: true }); audioEl.load(); }
      const bar = document.getElementById("au-state");
      if (bar) bar.textContent = "▶ играет " + (b - a) + " сек" + ((rate || 1) !== 1 ? ", скорость " + rate + "x" : "");
      return;
    }
    if (!player || !playerReady) { alert("Плеер ещё загружается, попробуй через пару секунд"); return; }
    try { player.setPlaybackRate(rate || 1); } catch (e) {}
    player.seekTo(a, true);
    player.playVideo();
    stopAt = b;
    onStop = done || null;
  }

  // ---------- навигация ----------
  let current = null;
  function show(view) {
    ["today", "library", "progress"].forEach(v => $("#view-" + v).classList.toggle("hidden", v !== view));
    document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
    if (view === "library") renderLibrary();
    if (view === "progress") renderProgress();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("nav button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.view === "today") openClip(current || pickToday());
    show(b.dataset.view);
  }));

  function pickToday() {
    const open = clips.find(c => !prog(c.id).done[6]);
    return open || clips[0] || null;
  }

  // ---------- экран отрывка ----------
  const LEVELS = ["Прогон", "Диктант", "Сверка", "Shadowing", "Пересказ", "Финал"];
  let level = 1;

  function openClip(clip) {
    current = clip;
    const root = $("#view-today");
    if (!clip) {
      root.innerHTML = '<div class="card"><h2>Первый отрывок за тобой</h2><p class="muted">Открой вкладку «Отрывки» и добавь видео с британской речью по ссылке YouTube и таймкодам, до минуты. Дальше отрывки будет подбирать ночной агент.</p></div>';
      return;
    }
    const p = prog(clip.id);
    level = 1;
    for (let k = 1; k <= 6; k++) if (p.done[k]) level = Math.min(6, k + 1);
    root.innerHTML =
      '<div class="card">' +
        '<h2>' + esc(clip.title) + '</h2>' +
        '<div class="muted">' + esc(clip.speaker || "") + '</div>' +
        '<div style="margin-top:8px">' +
          (clip.accent ? '<span class="tag">' + esc(clip.accent) + '</span>' : "") +
          (clip.topic ? '<span class="tag">' + esc(clip.topic) + '</span>' : "") +
          '<span class="tag">' + (clip.end - clip.start) + ' сек</span>' +
          (clip.level ? '<span class="tag">сложность ' + "★".repeat(clip.level) + '</span>' : "") +
        '</div>' +
        (clip.why ? '<p class="muted" style="margin:8px 0 0">' + esc(clip.why) + '</p>' : "") +
        (clip.episode_link ? '<p style="margin:6px 0 0"><a class="muted" target="_blank" rel="noopener" href="' + esc(clip.episode_link) + '">Весь выпуск</a></p>' : "") +
        (clip.audio
          ? '<div class="audio-card"><div class="wave">' + Array.from({ length: 28 }, (_, i) => '<i style="height:' + (20 + Math.round(60 * Math.abs(Math.sin(i * 1.7)))) + '%"></i>').join("") + '</div><div class="muted" id="au-state">аудио ' + (clip.end - clip.start) + ' сек, текст откроется на сверке</div></div>'
          : '<div class="player-wrap"><div id="yt"></div></div><div id="yt-err"></div>') +
        '<div class="steps" id="steps"></div>' +
      '</div>' +
      '<div id="level"></div>';
    if (clip.audio) mountAudio(clip); else mountPlayer($("#yt"), clip);
    renderSteps();
    renderLevel();
  }

  function renderSteps() {
    const p = prog(current.id);
    $("#steps").innerHTML = LEVELS.map((name, i) => {
      const k = i + 1;
      return '<div class="step ' + (p.done[k] ? "done " : "") + (k === level ? "on" : "") + '" data-k="' + k + '">' + k + '<br>' + name + '</div>';
    }).join("");
    $("#steps").querySelectorAll(".step").forEach(el => el.addEventListener("click", () => { level = +el.dataset.k; renderSteps(); renderLevel(); }));
  }

  function complete(k) {
    const p = prog(current.id);
    p.done[k] = true;
    save();
    markDay();
    level = Math.min(6, k + 1);
    renderSteps();
    renderLevel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rangeHtml(id, val) {
    return '<div class="range"><input type="range" id="' + id + '" min="0" max="100" step="5" value="' + (val == null ? 50 : val) + '"><b id="' + id + '-v">' + (val == null ? 50 : val) + '%</b></div>';
  }
  function bindRange(id) {
    const r = $("#" + id);
    r.addEventListener("input", () => { $("#" + id + "-v").textContent = r.value + "%"; });
    return r;
  }

  function focusTable(c) {
    let h = "";
    if (c.focus && c.focus.length) {
      h += '<h2 style="margin-top:14px">Конструкции</h2><table>' + c.focus.map(f => '<tr><td class="phrase">' + esc(f.phrase) + '</td><td>' + esc(f.note) + '</td></tr>').join("") + "</table>";
    }
    if (c.reductions && c.reductions.length) {
      h += '<h2 style="margin-top:14px">Что проглатывают</h2><table><tr><th>Написано</th><th>Слышишь</th><th>Почему</th></tr>' +
        c.reductions.map(r => '<tr><td>' + esc(r.written) + '</td><td class="phrase">' + esc(r.heard) + '</td><td class="muted">' + esc(r.why) + '</td></tr>').join("") + "</table>";
    }
    return h;
  }

  function renderLevel() {
    const c = current, p = prog(c.id), box = $("#level");
    const full = () => playRange(c.start, c.end, 1);

    if (level === 1) {
      box.innerHTML = '<div class="card"><h2>1. Первый прогон</h2>' +
        '<p class="muted">Послушай отрывок один раз без субтитров и запиши всё, что понял, даже обрывки. Это твоя точка старта.</p>' +
        '<div class="row"><button class="primary" id="play">▶ Слушать один раз</button></div>' +
        '<label>Что понял</label><textarea id="t">' + esc(p.notes1 || "") + '</textarea>' +
        '<label>Сколько понял, по ощущениям</label>' + rangeHtml("r", p.l1) +
        '<div class="row"><button class="primary" id="next">Сохранить и дальше</button></div></div>';
      $("#play").onclick = full;
      const r = bindRange("r");
      $("#next").onclick = () => { p.notes1 = $("#t").value; p.l1 = +r.value; complete(1); };
    }

    if (level === 2) {
      const n = Math.ceil((c.end - c.start) / 5);
      p.plays = p.plays || {};
      box.innerHTML = '<div class="card"><h2>2. Диктант по 5 секунд</h2>' +
        '<p class="muted">Включай кусок, пиши дословно, что слышишь. Каждый кусок максимум 3 раза, потом дальше, даже если не понял.</p>' +
        '<div class="chunks" id="chunks"></div>' +
        '<div class="row"><button class="ghost" id="slow">Текущий кусок на 0.75x</button></div>' +
        '<label>Диктант</label><textarea id="t" style="min-height:160px">' + esc(p.dict2 || "") + '</textarea>' +
        '<div class="row"><button class="primary" id="next">Готово, к сверке</button></div></div>';
      let cur = 0;
      const draw = () => {
        $("#chunks").innerHTML = Array.from({ length: n }, (_, i) =>
          '<button data-i="' + i + '"' + ((p.plays[i] || 0) >= 3 ? ' style="opacity:.55"' : "") + '>' + (i + 1) + ' · ' + (p.plays[i] || 0) + '/3</button>').join("");
        $("#chunks").querySelectorAll("button").forEach(b => b.onclick = () => {
          const i = +b.dataset.i; cur = i;
          p.plays[i] = (p.plays[i] || 0) + 1; save();
          b.classList.add("playing");
          playRange(c.start + i * 5, Math.min(c.end, c.start + i * 5 + 5), 1, draw);
        });
      };
      draw();
      $("#slow").onclick = () => playRange(c.start + cur * 5, Math.min(c.end, c.start + cur * 5 + 5), 0.75);
      $("#t").oninput = e => { p.dict2 = e.target.value; save(); };
      $("#next").onclick = () => { p.dict2 = $("#t").value; complete(2); };
    }

    if (level === 3) {
      if (c.transcript && !p.ref) { p.ref = c.transcript; save(); }
      const auto = !!c.transcript;
      box.innerHTML = '<div class="card"><h2>3. Сверка</h2>' +
        (auto ? '<p class="muted">Вот расшифровка' + (c.auto_transcript ? ', сделанная автоматически, так что изредка в ней бывают мелкие неточности' : '') + '. Нажми «Сверить диктант», и красным подсветятся слова, которые ты не расслышал.</p>'
              : '<p class="muted">Включи субтитры кнопкой CC в плеере и сравни со своим диктантом. Для автоматической сверки вставь ниже текст субтитров этого отрывка, он сохранится только у тебя на телефоне.</p>') +
        '<div class="row"><button id="play">▶ Ещё раз весь отрывок</button></div>' +
        '<label>' + (auto ? 'Оригинальный текст' : 'Текст субтитров (эталон)') + '</label><textarea id="ref" placeholder="Вставь сюда субтитры отрывка">' + esc(p.ref || "") + '</textarea>' +
        '<div class="row"><button class="primary" id="cmp">Сверить диктант</button></div>' +
        '<div id="res"></div>' + focusTable(c) +
        '<div class="row" style="margin-top:14px"><button class="primary" id="next">Разобрал, дальше</button></div></div>';
      $("#play").onclick = full;
      $("#ref").oninput = e => { p.ref = e.target.value; save(); };
      $("#cmp").onclick = () => {
        p.ref = $("#ref").value; save();
        if (!words(p.ref).length) { $("#res").innerHTML = '<div class="hint">Вставь сначала текст субтитров, тогда я подсвечу, что ты не расслышал.</div>'; return; }
        const r = compare(p.ref, p.dict2);
        p.l2 = r.pct; save();
        $("#res").innerHTML = '<div class="score">' + r.pct + '%</div><div class="muted" style="margin-bottom:8px">столько слов расслышал в диктанте, красным то, что пропустил</div><div class="diff">' + r.html + '</div>';
      };
      if (p.ref && p.dict2) $("#cmp").click();
      $("#next").onclick = () => complete(3);
    }

    if (level === 4) {
      box.innerHTML = '<div class="card"><h2>4. Shadowing</h2>' +
        '<p class="muted">Говори одновременно со спикером, копируй ритм, паузы и проглатывания. Паузы не заполняй словом yeah. Цель 5 повторов.</p>' +
        '<div class="counter" id="cnt">' + (p.shadow || 0) + ' / 5</div>' +
        '<div class="row"><button id="s75">▶ 0.75x</button><button class="primary" id="s1">▶ 1x</button></div>' +
        '<div class="row"><button class="primary" id="next"' + ((p.shadow || 0) >= 5 ? "" : " disabled") + '>Дальше</button></div></div>';
      const inc = () => { p.shadow = (p.shadow || 0) + 1; save(); $("#cnt").textContent = p.shadow + " / 5"; if (p.shadow >= 5) $("#next").disabled = false; };
      $("#s75").onclick = () => playRange(c.start, c.end, 0.75, inc);
      $("#s1").onclick = () => playRange(c.start, c.end, 1, inc);
      $("#next").onclick = () => complete(4);
    }

    if (level === 5) {
      const ph = (c.focus || []).map(f => '<span class="tag phrase">' + esc(f.phrase) + '</span>').join("");
      box.innerHTML = '<div class="card"><h2>5. Пересказ</h2>' +
        '<p class="muted">Послушай один раз и перескажи суть вслух по английски за 30 секунд. Постарайся вставить хотя бы две конструкции.</p>' +
        '<div style="margin:8px 0">' + ph + '</div>' +
        '<div class="row"><button id="play">▶ Слушать</button><button class="primary" id="rec">● Записать пересказ</button></div>' +
        '<audio id="au" controls class="hidden" style="width:100%;margin-top:8px"></audio>' +
        '<div class="row"><button class="primary" id="next">Пересказал, дальше</button></div></div>';
      $("#play").onclick = full;
      let mr = null, chunks = [];
      $("#rec").onclick = async () => {
        if (mr && mr.state === "recording") { mr.stop(); return; }
        try {
          const st = await navigator.mediaDevices.getUserMedia({ audio: true });
          mr = new MediaRecorder(st); chunks = [];
          mr.ondataavailable = e => chunks.push(e.data);
          mr.onstop = () => {
            st.getTracks().forEach(t => t.stop());
            const au = $("#au"); au.src = URL.createObjectURL(new Blob(chunks, { type: mr.mimeType })); au.classList.remove("hidden");
            $("#rec").textContent = "● Записать ещё раз";
          };
          mr.start(); $("#rec").textContent = "■ Стоп";
        } catch (e) { alert("Нет доступа к микрофону. Можно просто пересказать вслух."); }
      };
      $("#next").onclick = () => complete(5);
    }

    if (level === 6) {
      if (c.transcript && !p.ref) { p.ref = c.transcript; save(); }
      const hasRef = words(p.ref).length > 0;
      box.innerHTML = '<div class="card"><h2>6. Финальный тест</h2>' +
        '<p class="muted">Один прогон без субтитров, пиши дословно всё, что слышишь. Потом сравним со стартом.</p>' +
        '<div class="row"><button class="primary" id="play">▶ Слушать один раз</button></div>' +
        '<label>Финальный диктант</label><textarea id="t" style="min-height:160px">' + esc(p.dict6 || "") + '</textarea>' +
        (hasRef ? "" : '<label>Сколько понял теперь, по ощущениям</label>' + rangeHtml("r", p.l6)) +
        '<div class="row"><button class="primary" id="next">Проверить</button></div><div id="res"></div></div>';
      $("#play").onclick = full;
      const r = hasRef ? null : bindRange("r");
      $("#t").oninput = e => { p.dict6 = e.target.value; save(); };
      $("#next").onclick = () => {
        p.dict6 = $("#t").value;
        let html = "";
        if (hasRef) { const res = compare(p.ref, p.dict6); p.l6 = res.pct; html = '<div class="diff" style="margin-top:10px">' + res.html + "</div>"; }
        else p.l6 = +r.value;
        const base = p.l2 != null ? p.l2 : p.l1;
        const g = base != null ? p.l6 - base : null;
        p.finished = today();
        save();
        $("#res").innerHTML = '<div class="score">' + p.l6 + '%</div>' +
          (g != null ? '<div class="growth">' + (g >= 0 ? "+" : "") + g + ' п.п. к старту</div>' : "") + html +
          '<div class="row"><button id="lib">К отрывкам</button></div>';
        $("#lib").onclick = () => show("library");
        prog(c.id).done[6] = true; save(); markDay(); renderSteps();
      };
    }
  }

  // ---------- библиотека ----------
  function ytId(url) {
    const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
    return m ? m[1] : (/^[\w-]{11}$/.test(url) ? url : null);
  }
  function toSec(s) {
    s = String(s || "").trim();
    if (!s) return null;
    return s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
  }

  function renderLibrary() {
    const root = $("#view-library");
    root.innerHTML = '<div class="card"><h2>Отрывки</h2>' +
      clips.map(c => {
        const p = prog(c.id);
        const st = p.done[6] ? "✓ пройден" : (Object.keys(p.done).length ? "уровень " + Math.min(6, Object.keys(p.done).length + 1) : "новый");
        return '<div class="list-item" data-id="' + esc(c.id) + '"><div><b>' + esc(c.title) + '</b><div class="muted">' + esc(c.speaker || "") + ' · ' + (c.end - c.start) + ' сек</div></div><span class="tag">' + st + '</span></div>';
      }).join("") + '</div>' +
      '<div class="card"><h2>Добавить свой отрывок</h2>' +
      '<label>Ссылка на YouTube</label><input id="u" placeholder="https://youtu.be/...">' +
      '<div class="row"><div><label>Начало</label><input id="a" placeholder="59:49"></div><div><label>Конец</label><input id="b" placeholder="1:00:26"></div></div>' +
      '<label>Название</label><input id="n" placeholder="О чём отрывок">' +
      '<div class="row"><button class="primary" id="add">Добавить</button></div></div>';
    root.querySelectorAll(".list-item").forEach(el => el.onclick = () => {
      openClip(clips.find(c => c.id === el.dataset.id)); show("today");
    });
    $("#add").onclick = () => {
      const id = ytId($("#u").value.trim()), a = toSec($("#a").value), b = toSec($("#b").value);
      if (!id || a == null || b == null || b <= a) { alert("Проверь ссылку и время: начало раньше конца, формат 59:49 или 1:00:26"); return; }
      if (b - a > 120) { alert("Лучше до 60 секунд, максимум 2 минуты"); return; }
      const clip = { id: "my-" + Date.now(), date: today(), title: $("#n").value.trim() || "Мой отрывок", speaker: "добавлен вручную", videoId: id, start: a, end: b, focus: [], reductions: [] };
      state.custom.push(clip); save();
      clips.unshift(clip);
      openClip(clip); show("today");
    };
  }

  // ---------- прогресс ----------
  function renderProgress() {
    const root = $("#view-progress");
    const fin = clips.filter(c => prog(c.id).done[6]);
    const avg = fin.length ? Math.round(fin.reduce((s, c) => { const p = prog(c.id); const base = p.l2 != null ? p.l2 : (p.l1 || 0); return s + (p.l6 - base); }, 0) / fin.length) : null;
    root.innerHTML = '<div class="card"><h2>Прогресс</h2>' +
      '<div class="row"><div><div class="score">' + streak() + '</div><div class="muted">дней подряд</div></div>' +
      '<div><div class="score">' + fin.length + '</div><div class="muted">отрывков пройдено</div></div>' +
      '<div><div class="score">' + (avg == null ? "·" : (avg >= 0 ? "+" : "") + avg) + '</div><div class="muted">средний рост, п.п.</div></div></div></div>' +
      '<div class="card"><table><tr><th>Отрывок</th><th>Старт</th><th>Финал</th><th>Рост</th></tr>' +
      clips.map(c => {
        const p = prog(c.id); const base = p.l2 != null ? p.l2 : p.l1;
        return '<tr><td>' + esc(c.title) + '</td><td>' + (base != null ? base + "%" : "·") + '</td><td>' + (p.l6 != null ? p.l6 + "%" : "·") + '</td><td class="growth">' + (base != null && p.l6 != null ? (p.l6 - base >= 0 ? "+" : "") + (p.l6 - base) : "") + '</td></tr>';
      }).join("") + '</table><p class="muted" style="margin-bottom:0">Старт берётся из сверки диктанта, а если её не было, из самооценки на первом прогоне.</p></div>';
  }

  // ---------- запуск ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  loadClips().then(() => { renderStreak(); openClip(pickToday()); });
})();
