(() => {
  "use strict";

  const KRYMSK = { lat: 44.93, lon: 37.98, tz: "Europe/Moscow" };
  const WEATHER_URL =
    `https://api.open-meteo.com/v1/forecast?latitude=${KRYMSK.lat}&longitude=${KRYMSK.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&timezone=${encodeURIComponent(KRYMSK.tz)}`;
  const STORAGE_KEY = "toma-mood-v1";
  const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  const MOODS = [
    { id: 1, emoji: "😔", label: "тяжело" },
    { id: 2, emoji: "😐", label: "так себе" },
    { id: 3, emoji: "😊", label: "хорошо" },
    { id: 4, emoji: "😄", label: "отлично" },
    { id: 5, emoji: "🤩", label: "вау" }
  ];
  const WEATHER_MAP = {
    0: { text: "Ясно", icon: "☀️" },
    1: { text: "Почти ясно", icon: "🌤" },
    2: { text: "Переменная облачность", icon: "⛅" },
    3: { text: "Пасмурно", icon: "☁️" },
    45: { text: "Туман", icon: "🌫" },
    48: { text: "Изморозь", icon: "🌫" },
    51: { text: "Лёгкая морось", icon: "🌦" },
    53: { text: "Морось", icon: "🌦" },
    55: { text: "Сильная морось", icon: "🌧" },
    56: { text: "Ледяная морось", icon: "🌧" },
    57: { text: "Сильная ледяная морось", icon: "🌧" },
    61: { text: "Небольшой дождь", icon: "🌧" },
    63: { text: "Дождь", icon: "🌧" },
    65: { text: "Сильный дождь", icon: "🌧" },
    66: { text: "Ледяной дождь", icon: "🌧" },
    67: { text: "Сильный ледяной дождь", icon: "🌧" },
    71: { text: "Небольшой снег", icon: "🌨" },
    73: { text: "Снег", icon: "❄️" },
    75: { text: "Сильный снег", icon: "❄️" },
    77: { text: "Снежные зёрна", icon: "❄️" },
    80: { text: "Небольшой ливень", icon: "🌦" },
    81: { text: "Ливень", icon: "🌧" },
    82: { text: "Сильный ливень", icon: "🌧" },
    85: { text: "Снегопад", icon: "🌨" },
    86: { text: "Сильный снегопад", icon: "❄️" },
    95: { text: "Гроза", icon: "⛈" },
    96: { text: "Гроза с градом", icon: "⛈" },
    99: { text: "Сильная гроза с градом", icon: "⛈" }
  };

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.initData);
  function tgAtLeast(version) {
    return !!(inTelegram && typeof tg.isVersionAtLeast === "function" && tg.isVersionAtLeast(version));
  }
  const hasCloud = !!(tgAtLeast("6.9") && tg.CloudStorage && typeof tg.CloudStorage.getItem === "function");

  const state = {
    data: null,
    complimentIndex: 0,
    musicMood: "happy",
    moods: {}
  };

  function haptic(type) {
    try {
      if (!tgAtLeast("6.1")) return;
      const hf = tg && tg.HapticFeedback;
      if (!hf) return;
      if (type === "success" && hf.notificationOccurred) hf.notificationOccurred("success");
      else if (type === "soft" && hf.impactOccurred) hf.impactOccurred("soft");
      else if (hf.impactOccurred) hf.impactOccurred("light");
    } catch (_) { /* outside Telegram or unsupported client */ }
  }

  function moscowParts(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: KRYMSK.tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      weekday: "short",
      hourCycle: "h23"
    }).formatToParts(date);
    const get = (type) => {
      const p = parts.find((x) => x.type === type);
      return p ? p.value : "";
    };
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      hour: Number(get("hour"))
    };
  }

  function dateKey(date) {
    const p = moscowParts(date || new Date());
    const mm = String(p.month).padStart(2, "0");
    const dd = String(p.day).padStart(2, "0");
    return `${p.year}-${mm}-${dd}`;
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function timeGreeting(hour) {
    if (hour >= 5 && hour < 12) return "Доброе утро";
    if (hour >= 12 && hour < 17) return "Добрый день";
    if (hour >= 17 && hour < 23) return "Добрый вечер";
    return "Доброй ночи";
  }

  function formatHeroDate(date) {
    const p = moscowParts(date);
    const weekday = new Intl.DateTimeFormat("ru-RU", {
      timeZone: KRYMSK.tz,
      weekday: "long"
    }).format(date);
    return `${weekday}, ${p.day} ${MONTHS[p.month - 1]}`;
  }

  function clothingTip(temp, code, wind, precipitation) {
    const rainy = precipitation > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
    const snowy = [71, 73, 75, 77, 85, 86].includes(code);
    const foggy = [45, 48].includes(code);
    let tip;
    if (temp < 0 || snowy) tip = "Надень тёплое пальто, шарф и шапку, и выбери непромокаемую обувь.";
    else if (temp < 8) tip = "Возьми плотную куртку и закрытую обувь — утром в Крымске бывает зябко.";
    else if (temp < 15) tip = "Лёгкая куртка или кардиган будут кстати, особенно если вечер окажется прохладнее.";
    else if (temp < 22) tip = "Можно одеться легко, но захвати тонкий слой на всякий случай.";
    else if (temp < 28) tip = "Лёгкая одежда и удобная обувь. Если гулять дольше, возьми воду.";
    else tip = "Очень тепло: совсем лёгкая одежда, вода и головной убор, если будешь на солнце.";
    if (rainy) tip += " И не забудь зонт или дождевик.";
    else if (snowy) tip += " Осторожнее на скользких дорожках.";
    else if (wind >= 8) tip += " На улице ветрено — пригодится ветровка с капюшоном.";
    else if (foggy) tip += " В тумане лучше яркий элемент на одежде и чуть больше внимания на дороге.";
    return tip;
  }

  function initTelegram() {
    if (!inTelegram) return;
    try {
      if (typeof tg.ready === "function") tg.ready();
      if (typeof tg.expand === "function") tg.expand();
      if (tgAtLeast("6.1") && typeof tg.setHeaderColor === "function") tg.setHeaderColor("#f6d9e8");
      if (tgAtLeast("6.1") && typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("#f6d9e8");
      document.body.classList.add("tg-theme");
      setupMainButton("compliment");
    } catch (_) { /* older clients */ }
  }

  function setupMainButton(tab) {
    if (!inTelegram || !tg.MainButton) return;
    const labels = {
      compliment: "Ещё комплимент",
      music: "Следующее настроение",
      mood: "Сохранить день"
    };
    try {
      tg.MainButton.setText(labels[tab] || "Готово");
      if (tg.MainButton.show) tg.MainButton.show();
      if (!tg.MainButton._tomaBound) {
        tg.MainButton.onClick(() => onMainButton());
        tg.MainButton._tomaBound = true;
      }
    } catch (_) { /* ignore */ }
  }

  function onMainButton() {
    const active = document.querySelector(".tab.is-active");
    const tab = active ? active.getAttribute("data-tab") : "compliment";
    haptic("light");
    if (tab === "compliment") showCompliment(true);
    else if (tab === "music") cycleMusicMood();
    else if (tab === "mood") {
      const today = state.moods[dateKey(new Date())];
      if (today) haptic("success");
      else document.querySelector(".mood-btn[data-id='3']")?.click();
    }
  }

  function startSparkles() {
    const canvas = document.getElementById("sparkles");
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const particles = [];
    let width = 0;
    let height = 0;
    let raf = 0;

    function resize() {
      width = canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      height = canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    }

    function spawn() {
      const count = Math.min(42, Math.floor(window.innerWidth / 12));
      particles.length = 0;
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.6 + Math.random() * 1.6,
          s: 0.12 + Math.random() * 0.35,
          a: 0.15 + Math.random() * 0.45,
          tw: Math.random() * Math.PI * 2,
          tws: 0.01 + Math.random() * 0.02
        });
      }
    }

    function drawStar(x, y, r, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const angle = (i * Math.PI) / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        if (i === 0) ctx.moveTo(x + cos * r, y + sin * r);
        else ctx.lineTo(x + cos * r, y + sin * r);
        const mid = angle + Math.PI / 4;
        ctx.lineTo(x + Math.cos(mid) * r * 0.28, y + Math.sin(mid) * r * 0.28);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function tick() {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.s * (window.devicePixelRatio || 1);
        p.tw += p.tws;
        if (p.y < -8) {
          p.y = height + 8;
          p.x = Math.random() * width;
        }
        const alpha = p.a * (0.55 + 0.45 * Math.sin(p.tw));
        drawStar(p.x, p.y, p.r * (window.devicePixelRatio || 1) * 1.6, alpha);
      }
      raf = requestAnimationFrame(tick);
    }

    resize();
    spawn();
    tick();
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      resize();
      spawn();
      tick();
    });
  }

  async function loadData() {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Не удалось загрузить данные");
    state.data = await res.json();
  }

  function showCompliment(randomNext) {
    const list = state.data.compliments;
    if (!list || !list.length) return;
    if (randomNext) {
      let next = state.complimentIndex;
      if (list.length > 1) {
        while (next === state.complimentIndex) {
          next = Math.floor(Math.random() * list.length);
        }
      }
      state.complimentIndex = next;
    } else {
      state.complimentIndex = hashString(dateKey(new Date())) % list.length;
    }
    const el = document.getElementById("complimentText");
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    window.setTimeout(() => {
      el.textContent = list[state.complimentIndex];
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    }, 120);
  }

  function yandexUrl(artist, title) {
    return `https://music.yandex.ru/search?text=${encodeURIComponent(`${artist} ${title}`)}`;
  }

  function renderMusic(moodId) {
    const music = state.data.music[moodId] || state.data.music.happy;
    state.musicMood = music.id;
    document.getElementById("musicIntro").textContent = music.intro;
    const chips = document.getElementById("moodChips");
    chips.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("is-on", chip.getAttribute("data-mood") === music.id);
    });
    const list = document.getElementById("trackList");
    list.replaceChildren();
    music.tracks.forEach((track) => {
      const a = document.createElement("a");
      a.className = "track";
      a.href = yandexUrl(track.artist, track.title);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.addEventListener("click", () => haptic("light"));
      const meta = document.createElement("div");
      const title = document.createElement("p");
      title.className = "track-title";
      title.textContent = track.title;
      const artist = document.createElement("p");
      artist.className = "track-artist";
      artist.textContent = track.artist;
      meta.append(title, artist);
      const go = document.createElement("span");
      go.className = "track-go";
      go.textContent = "Яндекс Музыка";
      a.append(meta, go);
      list.append(a);
    });
  }

  function cycleMusicMood() {
    const keys = Object.keys(state.data.music);
    const i = keys.indexOf(state.musicMood);
    renderMusic(keys[(i + 1) % keys.length]);
  }

  function initMusicChips() {
    const wrap = document.getElementById("moodChips");
    wrap.replaceChildren();
    Object.values(state.data.music).forEach((mood) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("data-mood", mood.id);
      btn.textContent = `${mood.emoji} ${mood.label}`;
      btn.addEventListener("click", () => {
        haptic("light");
        renderMusic(mood.id);
      });
      wrap.append(btn);
    });
  }

  function readLocalMoods() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocalMoods(moods) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(moods));
    } catch (_) { /* private mode */ }
  }

  function cloudGet() {
    return new Promise((resolve) => {
      if (!hasCloud) {
        resolve(null);
        return;
      }
      const timer = window.setTimeout(() => resolve(null), 1500);
      try {
        tg.CloudStorage.getItem(STORAGE_KEY, (err, value) => {
          window.clearTimeout(timer);
          if (err || !value) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(value));
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        window.clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function cloudSet(moods) {
    if (!hasCloud) return;
    try {
      tg.CloudStorage.setItem(STORAGE_KEY, JSON.stringify(moods), () => {});
    } catch (_) { /* ignore */ }
  }

  async function loadMoods() {
    const local = readLocalMoods();
    const cloud = await cloudGet();
    state.moods = { ...(cloud || {}), ...local };
    if (cloud && Object.keys(local).length === 0) writeLocalMoods(state.moods);
  }

  function saveMood(id) {
    const key = dateKey(new Date());
    const mood = MOODS.find((m) => m.id === id);
    state.moods[key] = { id, emoji: mood.emoji, label: mood.label };
    writeLocalMoods(state.moods);
    cloudSet(state.moods);
    renderMoodUI();
    haptic("success");
  }

  function lastSevenKeys() {
    const keys = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      keys.push(dateKey(d));
    }
    return keys;
  }

  function renderMoodUI() {
    const today = dateKey(new Date());
    const current = state.moods[today];
    document.querySelectorAll(".mood-btn").forEach((btn) => {
      btn.classList.toggle("is-on", current && Number(btn.getAttribute("data-id")) === current.id);
    });
    const status = document.getElementById("moodStatus");
    status.textContent = current
      ? `Сегодня: ${current.emoji} ${current.label}. Можно поменять в любой момент.`
      : "Отметь, как ты себя чувствуешь сегодня.";

    const chart = document.getElementById("moodChart");
    chart.replaceChildren();
    lastSevenKeys().forEach((key) => {
      const entry = state.moods[key];
      const date = new Date(`${key}T12:00:00+03:00`);
      const col = document.createElement("div");
      col.className = "chart-col" + (key === today ? " is-today" : "");
      const emoji = document.createElement("div");
      emoji.className = "chart-emoji";
      emoji.textContent = entry ? entry.emoji : "";
      const bar = document.createElement("div");
      bar.className = "chart-bar" + (entry ? " is-filled" : "");
      const h = entry ? 18 + entry.id * 16 : 12;
      bar.style.height = `${h}px`;
      const day = document.createElement("div");
      day.className = "chart-day";
      day.textContent = WEEKDAYS[date.getDay()];
      col.append(emoji, bar, day);
      chart.append(col);
    });
  }

  function initMoodPicker() {
    const wrap = document.getElementById("moodPicker");
    wrap.replaceChildren();
    MOODS.forEach((mood) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mood-btn";
      btn.setAttribute("data-id", String(mood.id));
      btn.innerHTML = `<span class="emoji"></span><span class="lbl"></span>`;
      btn.querySelector(".emoji").textContent = mood.emoji;
      btn.querySelector(".lbl").textContent = mood.label;
      btn.addEventListener("click", () => saveMood(mood.id));
      wrap.append(btn);
    });
  }

  function switchTab(tab) {
    document.querySelectorAll(".tab").forEach((btn) => {
      const on = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      const on = panel.id === `panel-${tab}`;
      panel.classList.toggle("is-active", on);
      if (on) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
    setupMainButton(tab);
    haptic("soft");
  }

  async function loadWeather() {
    const loading = document.getElementById("weatherLoading");
    const ready = document.getElementById("weatherReady");
    const error = document.getElementById("weatherError");
    loading.classList.remove("hidden");
    ready.classList.add("hidden");
    error.classList.add("hidden");
    try {
      const res = await fetch(WEATHER_URL);
      if (!res.ok) throw new Error("weather http");
      const data = await res.json();
      const cur = data.current || {};
      const temp = Math.round(cur.temperature_2m);
      const feels = Math.round(cur.apparent_temperature);
      const code = Number(cur.weather_code);
      const wind = Number(cur.wind_speed_10m || 0);
      const precipitation = Number(cur.precipitation || 0);
      const meta = WEATHER_MAP[code] || { text: "Крымск", icon: "🌤" };
      document.getElementById("weatherIcon").textContent = meta.icon;
      document.getElementById("weatherTemp").textContent = String(temp);
      document.getElementById("weatherDesc").textContent = `${meta.text} · Крымск`;
      document.getElementById("weatherFeels").textContent = `Ощущается как ${feels}°`;
      document.getElementById("weatherTip").textContent = clothingTip(temp, code, wind, precipitation);
      loading.classList.add("hidden");
      ready.classList.remove("hidden");
    } catch (_) {
      loading.classList.add("hidden");
      error.classList.remove("hidden");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });
    document.getElementById("nextCompliment").addEventListener("click", () => {
      haptic("light");
      showCompliment(true);
    });
    document.getElementById("weatherRetry").addEventListener("click", () => {
      haptic("light");
      loadWeather();
    });
  }

  async function start() {
    const now = new Date();
    const parts = moscowParts(now);
    document.getElementById("timeGreeting").textContent = timeGreeting(parts.hour);
    document.getElementById("heroDate").textContent = formatHeroDate(now);
    initTelegram();
    startSparkles();
    bindEvents();
    try {
      await loadData();
    } catch (err) {
      document.getElementById("complimentText").textContent =
        "Не удалось загрузить данные. Открой страницу через сайт, а не как файл.";
      return;
    }
    showCompliment(false);
    initMusicChips();
    renderMusic("happy");
    initMoodPicker();
    await loadMoods();
    renderMoodUI();
    loadWeather();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      start().catch(() => {});
    });
  } else {
    start().catch(() => {});
  }
})();
