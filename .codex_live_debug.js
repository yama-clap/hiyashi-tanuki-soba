const CDP_PORT = 9233;
const MAIN = 'https://hiyashi-tanuki.pages.dev/';
const BACKUP = 'https://yama-clap.github.io/hiyashi-tanuki-soba/';

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, body: JSON.parse(text), text };
  } catch {
    return { status: res.status, ok: res.ok, body: null, text };
  }
}

async function connectBrowser() {
  const info = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const ws = new WebSocket(info.body.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return makeClient(ws);
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  return {
    events,
    send(method, params = {}) {
      return new Promise((resolve) => {
        const msg = { id: ++id, method, params };
        pending.set(msg.id, resolve);
        ws.send(JSON.stringify(msg));
      });
    },
    close() {
      try { ws.close(); } catch {}
    }
  };
}

async function newPage(browser, url) {
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  const tab = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const pageInfo = tab.body.find((p) => p.id === target.result.targetId);
  const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const page = makeClient(ws);
  const seen = { console: [], exception: [], failed: [], log: [] };
  const oldOnMessage = ws.onmessage;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      seen.console.push({ type: msg.params.type, text: (msg.params.args || []).map((a) => a.value || a.description || '').join(' ') });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      seen.exception.push(msg.params.exceptionDetails.text || msg.params.exceptionDetails.exception?.description || 'exception');
    }
    if (msg.method === 'Network.loadingFailed') {
      seen.failed.push({ url: msg.params.requestId, errorText: msg.params.errorText, type: msg.params.type });
    }
    if (msg.method === 'Log.entryAdded') {
      seen.log.push({ level: msg.params.entry.level, text: msg.params.entry.text });
    }
    oldOnMessage(event);
  };
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Page.navigate', { url });
  await wait(1200);
  return { page, seen, targetId: target.result.targetId };
}

async function closePage(browser, page, targetId) {
  page.close();
  await browser.send('Target.closeTarget', { targetId });
}

async function evalJson(page, expression, awaitPromise = false) {
  const res = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (res.result.exceptionDetails) {
    return {
      error: res.result.exceptionDetails.text,
      description: res.result.exceptionDetails.exception?.description || null
    };
  }
  const value = res.result.result.value;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inspectGame(browser, baseUrl) {
  const out = { baseUrl };
  let p = await newPage(browser, baseUrl);
  out.initial = await evalJson(p.page, `JSON.stringify((() => {
    const c = document.querySelector('canvas');
    const r = c ? c.getBoundingClientRect() : {};
    return {
      title: document.title,
      href: location.href,
      state: typeof game !== 'undefined' ? game.state : null,
      hasCanvas: !!c,
      canvasCss: c ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      rankingEnabled: typeof rankingEnabled === 'function' ? rankingEnabled() : null,
      fontReady: document.fonts ? document.fonts.check('12px PixelFont') : null,
      nav: {
        howto: typeof howtoRect === 'function' ? howtoRect() : null,
        ranking: typeof rankingRect === 'function' ? rankingRect() : null,
        mute: typeof muteRect === 'function' ? muteRect() : null
      },
      missingAssets: typeof assets !== 'undefined' ? Object.keys(assets).filter(k => !assets[k].ready) : null
    };
  })())`);
  out.initialEvents = p.seen;

  out.ranking = await evalJson(p.page, `JSON.stringify(await (async () => {
    if (typeof showRanking !== 'function') return { available: false };
    await showRanking();
    await new Promise(r => setTimeout(r, 900));
    return {
      available: true,
      state: game.state,
      phase: rankPhase,
      rows: rankRows ? rankRows.length : null,
      sample: !!rankUsingSample,
      first: rankRows && rankRows[0] ? { name: rankRows[0].name, score: rankRows[0].score } : null,
      backRect: typeof backRectRanking === 'function' ? backRectRanking() : null
    };
  })())`, true);

  out.result = await evalJson(p.page, `JSON.stringify((() => {
    if (typeof endGame !== 'function') return { available: false };
    game.state = STATE.PLAY;
    game.bowls = 6;
    game.bonusBowls = 2;
    game.maxCombo = 12;
    game.poured = 0;
    game.hiscore = 14;
    endGame();
    draw();
    const reg = registerRect();
    const retry = retryRect();
    handleRegisterTap();
    const modal = document.getElementById('nameModal');
    return {
      available: true,
      state: game.state,
      lastScore: game.lastScore,
      rank: rankForScore(game.lastScore),
      next: nextRankInfo(game.lastScore),
      registerRect: reg,
      retryRect: retry,
      overlapRegisterRetry: !(reg.x + reg.w < retry.x || retry.x + retry.w < reg.x || reg.y + reg.h < retry.y || retry.y + retry.h < reg.y),
      modalOpen: modal ? !modal.classList.contains('hidden') : null,
      submitNotClicked: true
    };
  })())`);

  await closePage(browser, p.page, p.targetId);

  p = await newPage(browser, baseUrl + '?play=1');
  out.autoplay = await evalJson(p.page, `JSON.stringify((() => ({
    href: location.href,
    search: location.search,
    state: typeof game !== 'undefined' ? game.state : null,
    timeLeft: typeof game !== 'undefined' ? Math.ceil(game.timeLeft) : null
  }))())`);
  out.autoplayEvents = p.seen;
  await closePage(browser, p.page, p.targetId);

  return out;
}

async function inspectHowto(browser, url) {
  const p = await newPage(browser, url);
  const result = await evalJson(p.page, `JSON.stringify((() => {
    const body = document.body;
    const links = [...document.querySelectorAll('a')].map(a => ({ text: a.textContent.trim(), href: a.href }));
    const comboText = document.querySelector('.combo')?.textContent.replace(/\\s+/g, ' ').trim() || '';
    return {
      href: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent.trim() || '',
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 || body.scrollWidth > document.documentElement.clientWidth + 2,
      fontReady: document.fonts ? document.fonts.check('12px PixelFont') : null,
      comboText,
      links
    };
  })())`);
  const seen = p.seen;
  await closePage(browser, p.page, p.targetId);
  return { result, seen };
}

async function supabaseProbe(browser, baseUrl) {
  const p = await newPage(browser, baseUrl);
  const result = await evalJson(p.page, `JSON.stringify(await (async () => {
    const c = window.RANKING;
    const base = String(c.url).replace(/\\/+$/, '') + '/rest/v1/' + (c.table || 'scores');
    const headers = {
      apikey: c.anonKey,
      Authorization: 'Bearer ' + c.anonKey,
      'Content-Type': 'application/json'
    };
    async function req(path, opts = {}) {
      const res = await fetch(base + path, { headers, ...opts });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text: text.slice(0, 180) };
    }
    return {
      select: await req('?select=id,name,score,combo,created_at&order=score.desc,created_at.asc&limit=1'),
      badScore: await req('', { method: 'POST', body: JSON.stringify({ name: 'codex_invalid', score: 999, combo: 0 }) }),
      blankName: await req('', { method: 'POST', body: JSON.stringify({ name: '', score: 1, combo: 1 }) }),
      patch: await req('?id=eq.-999999999', { method: 'PATCH', body: JSON.stringify({ score: 0 }) }),
      del: await req('?id=eq.-999999999', { method: 'DELETE' })
    };
  })())`, true);
  const seen = p.seen;
  await closePage(browser, p.page, p.targetId);
  return { result, seen };
}

(async () => {
  const browser = await connectBrowser();
  const report = {};
  try {
    report.main = await inspectGame(browser, MAIN);
    report.backup = await inspectGame(browser, BACKUP);
    report.howtoClean = await inspectHowto(browser, MAIN + 'howto');
    report.howtoHtml = await inspectHowto(browser, MAIN + 'howto.html');
    report.supabase = await supabaseProbe(browser, MAIN);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.send('Browser.close').catch(() => {});
    browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
