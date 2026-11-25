// PANAX capture — content script (runs on every panaxgames.com page; only acts in a tab in capture mode)
//   hover = dashed band, click = select block, Shift+click = add/remove block, ↑↓ / Alt+wheel = wider/narrower,
//   Enter or the 📸 button = capture, Esc = clear, C = selection mode on/off (off = page works normally)

(() => {
  if (window.__pxcap) return;
  window.__pxcap = true;

  const WIDE = 0.8;                 // a "block" spans at least 80% of the screen width
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vw = () => document.documentElement.clientWidth;
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ── block chain under a point: innermost wide element first, outward; identical boxes collapsed ──
  function wideChain(el) {
    const out = [];
    let lastKey = '';
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width < vw() * WIDE || r.height < 8) continue;
      const key = Math.round(r.top) + ':' + Math.round(r.height);
      if (key === lastKey) { out[out.length - 1] = el; continue; }   // same box: keep the outer one
      out.push(el);
      lastKey = key;
    }
    return out;
  }

  const docRange = els => {
    let top = Infinity, bottom = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      top = Math.min(top, r.top + scrollY);
      bottom = Math.max(bottom, r.bottom + scrollY);
    }
    return { top, bottom };
  };

  // ── locators ──
  // PANAX feeds are virtualized lists (rows carry data-index, only ~5 posts exist in the DOM at a time).
  // A selected post is removed from the page as soon as it scrolls far enough away, and comes back as a
  // NEW element. So a selection keeps a locator: the list row (data-index inside its list) + the path from
  // that row (or from <body> outside lists), plus where it was on the page.
  const cls = el => el.getAttribute('class') || '';
  function pathOf(el, root) {
    const steps = [];
    for (; el && el !== root; el = el.parentElement) {
      const p = el.parentElement;
      if (!p) return null;
      const same = [...p.children].filter(c => c.tagName === el.tagName && cls(c) === cls(el));
      steps.unshift({ tag: el.tagName, cls: cls(el), i: same.indexOf(el), n: [...p.children].indexOf(el) });
    }
    return steps;
  }
  function resolve(steps, root) {
    let el = root;
    for (const s of steps || []) {
      const kids = [...el.children];
      const same = kids.filter(c => c.tagName === s.tag && cls(c) === s.cls);
      let next = same[s.i] || same[same.length - 1];
      if (!next) {                                     // class changed (state class etc.): same tag, nearest index
        const tagged = kids.filter(c => c.tagName === s.tag);
        next = tagged.sort((a, b) => Math.abs(kids.indexOf(a) - s.n) - Math.abs(kids.indexOf(b) - s.n))[0];
      }
      if (!next) return null;
      el = next;
    }
    return el;
  }
  function locate(el) {
    const a = el.closest('[data-index]');
    const r = el.getBoundingClientRect();
    return {
      el, docTop: r.top + scrollY, docBottom: r.bottom + scrollY,
      anchor: a ? a.getAttribute('data-index') : null,
      listPath: a ? pathOf(a.parentElement, document.body) : null,
      path: pathOf(el, a || document.body),
    };
  }
  function findNow(loc) {
    if (loc.el?.isConnected) return loc.el;
    let root = document.body;
    if (loc.anchor != null) {
      const list = resolve(loc.listPath, document.body);
      const row = list && [...list.children].find(c => c.getAttribute('data-index') === loc.anchor);
      if (!row) return null;                            // row not rendered right now
      root = row;
    }
    const el = resolve(loc.path, root);
    if (el) loc.el = el;
    return el;
  }
  // like findNow, but scrolls to where the block was so a virtualized list renders it again
  // (measured on the PANAX feed: a post comes back ~0.8s after scrolling to it, so poll up to 3s)
  async function find(loc) {
    let el = findNow(loc);
    if (el) return el;
    scrollTo(0, Math.max(0, loc.docTop - 100));
    for (const end = Date.now() + 3000; !el && Date.now() < end;) {
      await sleep(150);
      el = findNow(loc);
    }
    return el;
  }
  async function findAll(locs) {
    const out = [];
    for (const l of locs) {
      const el = await find(l);
      if (!el) return null;
      out.push(el);
    }
    return out;
  }

  let ui = null;
  let bypass = false;            // our own programmatic clicks must get past the click-swallowing listeners
  chrome.runtime.sendMessage({ type: 'hello' }, res => {
    if (!chrome.runtime.lastError && res?.on) ui = makeUI();
  });

  // ── capture preparation ──
  let undo = [], savedScroll = 0, locs = [];
  const setStyle = (el, prop, val) => {
    undo.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, val, 'important');
  };
  function restoreStyles() {
    for (const [el, prop, v, pri] of undo.reverse()) v ? el.style.setProperty(prop, v, pri) : el.style.removeProperty(prop);
    undo = [];
  }

  async function waitImages(top, bottom) {
    const inRange = el => { const r = el.getBoundingClientRect(); return r.bottom + scrollY > top && r.top + scrollY < bottom && r.width > 0; };
    const imgs = [...document.images].filter(inRange);
    const ok = img => img.complete && img.naturalWidth > 0;
    // flipping loading=lazy→eager alone does not start a deferred load (tested on PANAX):
    // re-set srcset/src so the browser requests them now
    const kick = imgs.filter(img => !ok(img));
    for (const img of kick) {
      img.loading = 'eager';
      for (const a of ['srcset', 'src']) {
        const v = img.getAttribute(a);
        if (v) { img.removeAttribute(a); img.setAttribute(a, v); }
      }
    }
    await Promise.race([
      Promise.all(kick.map(img => ok(img) ? null : new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }))),
      sleep(15000),
    ]);
    await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    // CSS background images (hero banner etc.)
    const urls = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg.includes('url(') && inRange(el))
        for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) urls.add(m[1]);
    }
    await Promise.race([
      Promise.all([...urls].map(u => { const i = new Image(); i.src = u; return i.decode().catch(() => {}); })),
      sleep(10000),
    ]);
    await document.fonts.ready;
  }

  function hideTranslateRows(targets) {
    const re = /^(see original|view original|show original|see translation|auto[- ]?translated|translated automatically|원문 보기|원문보기|번역 보기|자동 번역됨)$/i;
    for (const t of targets) {
      for (const el of t.querySelectorAll('*')) {
        if (el.children.length || !re.test((el.textContent || '').trim())) continue;
        let row = el;
        while (row.parentElement && row.parentElement !== t && (row.parentElement.innerText || '').trim().length <= 60) row = row.parentElement;
        if (targets.some(x => row.contains(x))) continue;   // never hide a selected block itself
        if (getComputedStyle(row).display !== 'none') setStyle(row, 'display', 'none');
      }
    }
  }

  // PANAX shows posts machine-translated into the account language with a "See original" toggle.
  // For the capture we press every toggle inside the selection, and press them again afterwards.
  const ORIGINAL_RE = /^(see original|view original|show original|원문 보기|원문보기|原文を見る|原文を表示)$/i;
  let toggled = [];
  const leafText = el => !el.children.length && (el.textContent || '').trim();
  const press = el => { bypass = true; try { el.click(); } finally { bypass = false; } };
  const togglesIn = root => [...root.querySelectorAll('*')]
    .filter(el => ORIGINAL_RE.test(leafText(el) || ''))
    .map(el => el.closest('button,a,[role=button]') || el);
  // The toggle sits in the post header, so a selection of just the post body has none inside.
  // Then climb to the nearest ancestor holding exactly one toggle (that post's own); stop if an
  // ancestor holds several (we've reached a list of posts).
  function togglesFor(t) {
    const own = togglesIn(t);
    if (own.length) return own;
    for (let a = t.parentElement, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
      const found = togglesIn(a);
      if (found.length === 1) return found;
      if (found.length > 1) return [];
    }
    return [];
  }
  async function showOriginals(targets) {
    toggled = [...new Set(targets.flatMap(togglesFor))];
    for (const b of toggled) press(b);
    // wait until the labels flip (the original text has been swapped in), max 4s
    const end = Date.now() + 4000;
    while (Date.now() < end && toggled.some(b => b.isConnected && ORIGINAL_RE.test((b.textContent || '').trim()))) await sleep(150);
    if (toggled.length) await sleep(400);
  }
  function hideOriginals() {
    for (const b of toggled) if (b.isConnected) press(b);
    toggled = [];
  }

  const fail = error => ({ ok: false, error });

  // step 1: find the blocks, switch to originals, hide floating bars, report how tall the strip is.
  // The page is never scrolled away from the selection (feeds would drop the selected posts).
  async function prepare(opt) {
    cleanup();
    locs = ui ? ui.locs() : [];
    if (!locs.length) return fail('선택한 블록이 없음 — 블록을 먼저 클릭하세요');
    savedScroll = scrollY;
    ui.hide(true);
    let targets = await findAll(locs);
    if (!targets) return fail('선택한 블록을 다시 찾지 못함 — 다시 선택해 주세요');
    if (opt.original) {
      await showOriginals(targets);
      targets = await findAll(locs);               // the post may have been re-rendered
      if (!targets) return fail('원문으로 바꾼 뒤 블록을 다시 찾지 못함');
    }
    if (opt.hideTranslate) hideTranslateRows(targets);

    // floating bars: hide fixed ones, put sticky ones back in the flow
    // (static, not relative: a sticky "top:48px" would shift a relative element)
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' && !targets.some(t => el.contains(t) || t.contains(el))) setStyle(el, 'visibility', 'hidden');
      else if (pos === 'sticky') setStyle(el, 'position', 'static');
    }
    await frame();
    const { top, bottom } = docRange(targets);
    if (!(bottom - top >= 1)) return fail('선택한 블록의 높이가 0 — 다시 선택해 주세요');
    return { ok: true, h: bottom - top, vh: innerHeight };
  }

  // step 2 (after the background has made the viewport tall enough, if needed): scroll the strip to the
  // top of the viewport, let the page render it, load every image, measure the final strip
  async function measure() {
    let targets = await findAll(locs);
    if (!targets) return fail('블록을 다시 찾지 못함');
    scrollTo(0, docRange(targets).top);
    await sleep(400);
    targets = await findAll(locs);
    if (!targets) return fail('블록을 다시 찾지 못함');
    let r = docRange(targets);
    await waitImages(r.top, r.bottom);
    await sleep(500);                               // let image fade-ins finish
    await frame();
    targets = await findAll(locs);
    if (!targets) return fail('블록을 다시 찾지 못함');
    r = docRange(targets);
    const y = Math.floor(r.top), h = Math.ceil(r.bottom) - y;
    if (!(h >= 1)) return fail('선택한 블록의 높이가 0');
    const viewTop = r.top - scrollY;
    if (viewTop < -1 || viewTop + h > innerHeight + 2) return fail('영역이 화면 안에 다 들어오지 않음');
    return { ok: true, y, h, w: vw(), title: document.title };
  }

  function cleanup() {
    restoreStyles();
    hideOriginals();
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    switch (msg.type) {
      case 'prepare':
        prepare(msg).then(reply, e => reply(fail(e.message)));
        return true;
      case 'measure':
        measure().then(reply, e => reply(fail(e.message)));
        return true;
      case 'restore':
        cleanup();
        scrollTo(0, savedScroll);
        ui?.hide(false);
        reply({ ok: true });
        return;
      case 'getSel':
        reply(ui ? ui.info() : { on: false });
        return;
      case 'clearSel':
        ui?.clear();
        reply({ ok: true });
        return;
      case 'captured':
        ui?.done(msg);
        return;
      case 'off':
        ui?.destroy();
        ui = null;
        return;
    }
  });

  // ════════════════════════════ UI ════════════════════════════
  function makeUI() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host{all:initial}
        *{box-sizing:border-box;font-family:system-ui,'Malgun Gothic',sans-serif}
        .band{position:fixed;left:0;right:0;display:none}
        .hover{border:2px dashed rgba(78,161,255,.9);background:rgba(78,161,255,.08)}
        .sel{border:2px solid #3ddc97;background:rgba(61,220,151,.13)}
        .tag{position:absolute;left:4px;top:4px;font:600 11px/18px system-ui,sans-serif;color:#0b2;background:#fff;padding:0 6px;border-radius:4px;white-space:nowrap;color:#111}
        .sel .tag{background:#3ddc97}
        .bar{position:fixed;left:8px;right:8px;bottom:8px;pointer-events:auto;display:flex;gap:6px;align-items:center;
             background:rgba(18,18,22,.94);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,.5);color:#fff}
        .info{flex:1;min-width:0;font-size:12px;line-height:1.3;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .info b{font-weight:700}
        .info small{display:block;color:#9aa;font-size:10.5px}
        button{border:0;border-radius:10px;font-size:12px;font-weight:700;padding:8px 10px;cursor:pointer;color:#fff;background:#2c2c34;white-space:nowrap}
        button:hover{background:#3a3a44}
        .shot{background:#4ea1ff;font-size:13px;padding:8px 14px}
        .shot:hover{background:#3b8fee}
        .shot:disabled{background:#33465c;color:#8aa;cursor:default}
        .mode.off{background:#5a4320}
        .toast{position:fixed;left:8px;right:8px;bottom:64px;font-size:12px;line-height:1.5;color:#fff;background:rgba(20,20,20,.94);border-radius:10px;padding:8px 10px;display:none;word-break:break-all}
        .toast.err{background:rgba(160,30,30,.95)}
        .hidden{display:none!important}
      </style>
      <div class="band hover"><span class="tag"></span></div>
      <div class="sels"></div>
      <div class="toast"></div>
      <div class="bar">
        <button class="mode" title="C">선택 ON</button>
        <div class="info"></div>
        <button class="clear" title="Esc">해제</button>
        <button class="shot" title="Enter" disabled>📸 캡처</button>
        <button class="panel" title="도구 패널 열기">⚙</button>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = s => root.querySelector(s);
    const hover = $('.hover'), hoverTag = $('.hover .tag'), sels = $('.sels'), toast = $('.toast');
    const bar = $('.bar'), info = $('.info'), btnShot = $('.shot'), btnMode = $('.mode');
    // selected: [{chain, level}] — the block is chain[level]
    let on = true, busy = false, chain = [], level = 0, selected = [], lastPt = null, lastWasClick = false, toastTimer;
    let url = location.href;
    const scale = devicePixelRatio;
    // a selection item: { chain, level, loc } — the block is chain[level]. If a feed dropped it from the
    // DOM and rendered it again, find the new element through the locator and rebuild the chain from it.
    const item = (c, l) => ({ chain: c, level: l, loc: locate(c[l]) });
    function elOf(s) {
      const el = s.chain[s.level];
      if (el?.isConnected) return el;
      const found = findNow(s.loc);
      if (found) { s.chain = wideChain(found); if (s.chain[0] !== found) s.chain = [found]; s.level = 0; }
      return found;
    }

    const place = (b, el) => {
      const r = el.getBoundingClientRect();
      b.style.top = r.top + 'px';
      b.style.height = r.height + 'px';
      b.style.display = 'block';
      return r;
    };

    function info_() {
      if (!selected.length) return { on: true, count: 0 };
      let top = Infinity, bottom = -Infinity;
      for (const s of selected) {
        const el = elOf(s);
        const r = el ? docRange([el]) : { top: s.loc.docTop, bottom: s.loc.docBottom };   // off-screen in a feed
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
      }
      const px = `${Math.round(vw() * scale)} × ${Math.round((bottom - top) * scale)}`;
      return { on: true, count: selected.length, px };
    }
    function notify() { chrome.runtime.sendMessage({ type: 'sel', ...info_() }).catch(() => {}); }

    function draw() {
      // selected bands
      sels.innerHTML = '';
      selected.forEach((s, i) => {
        const el = elOf(s);
        if (!el) return;
        const b = document.createElement('div');
        b.className = 'band sel';
        b.innerHTML = `<span class="tag">${selected.length > 1 ? i + 1 + ' · ' : ''}${s.level + 1}/${s.chain.length}</span>`;
        sels.appendChild(b);
        place(b, el);
      });
      // hover band
      const cur = chain[level];
      if (on && cur && !busy && !selected.some(s => elOf(s) === cur)) {
        const r = place(hover, cur);
        hoverTag.textContent = `클릭해서 선택 · ${level + 1}/${chain.length} · ${Math.round(r.height)}pt`;
      } else hover.style.display = 'none';
      // bar
      const i = info_();
      info.innerHTML = busy ? '<b>캡처 중…</b><small>이미지를 모두 불러오는 중</small>'
        : i.count ? `<b>${i.count}개 블록</b> · ${i.px}px<small>Shift+클릭 추가 · ↑↓ 범위</small>`
        : on ? '<b>블록을 클릭해 선택</b><small>↑↓ / Alt+휠 = 범위 · Shift+클릭 = 여러 개</small>'
        : '<b>선택 꺼짐</b><small>페이지를 평소처럼 누를 수 있음 · C로 다시 켜기</small>';
      btnShot.disabled = busy || !i.count;
      btnMode.textContent = on ? '선택 ON' : '선택 OFF';
      btnMode.classList.toggle('off', !on);
    }

    function pick() {
      if (!lastPt || busy || !on) return;
      const el = document.elementFromPoint(lastPt.x, lastPt.y);
      if (!el || el === host) return;
      const c = wideChain(el);
      if (c[0] !== chain[0]) { chain = c; level = Math.min(level, Math.max(0, c.length - 1)); }
      draw();
    }
    function step(d) {
      if (lastWasClick && selected.length) {
        const s = selected[selected.length - 1];
        if (!elOf(s)) return;
        s.level = Math.max(0, Math.min(s.chain.length - 1, s.level + d));
        s.loc = locate(s.chain[s.level]);
      } else {
        level = Math.max(0, Math.min(chain.length - 1, level + d));
      }
      draw(); notify();
    }
    function setOn(v) { on = v; draw(); }
    function clear() { selected = []; lastWasClick = false; draw(); notify(); }
    function showToast(text, err) {
      toast.textContent = text;
      toast.classList.toggle('err', !!err);
      toast.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.style.display = 'none', err ? 6000 : 3500);
    }
    function shoot() {
      if (busy || !info_().count) return;
      busy = true; draw();
      chrome.runtime.sendMessage({ type: 'capture' }, () => void chrome.runtime.lastError);  // result comes back as 'captured'
    }

    const onBar = e => e.composedPath().includes(bar);
    $('.mode').onclick = () => setOn(!on);
    $('.clear').onclick = clear;
    btnShot.onclick = shoot;
    $('.panel').onclick = () => chrome.runtime.sendMessage({ type: 'openPanel' });

    const listeners = [];
    const listen = (t, f, o = true) => { addEventListener(t, f, o); listeners.push([t, f, o]); };

    listen('mousemove', e => { lastPt = { x: e.clientX, y: e.clientY }; if (on) { lastWasClick = false; pick(); } });
    listen('scroll', () => { pick(); draw(); });
    listen('resize', () => draw());
    listen('wheel', e => {
      if (!on || !e.altKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);                 // wheel up = wider
    }, { passive: false, capture: true });
    listen('keydown', e => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) { setOn(!on); return; }
      if (e.key === 'Enter' && selected.length) { e.preventDefault(); shoot(); return; }
      if (!on) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape') clear();
    });

    // swallow presses so links / carousels don't react while selecting
    const swallow = e => {
      if (!on || bypass || onBar(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend', 'auxclick', 'dblclick'])
      listen(t, swallow, { capture: true, passive: false });

    listen('click', e => {
      if (!on || bypass || onBar(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const cur = chain[level];
      if (busy || !cur) return;
      const idx = selected.findIndex(s => elOf(s) === cur);
      if (e.shiftKey) {
        if (idx >= 0) selected.splice(idx, 1);
        else selected.push(item(chain, level));
      } else {
        selected = idx >= 0 && selected.length === 1 ? [] : [item(chain, level)];
      }
      lastWasClick = true;
      draw(); notify();
    });

    // SPA navigation: old selection no longer exists
    const urlTimer = setInterval(() => {
      if (location.href !== url) { url = location.href; chain = []; clear(); }
    }, 500);

    draw(); notify();

    return {
      // fresh locators (positions re-read for blocks that are on the page right now)
      locs: () => selected.map(s => { const el = elOf(s); if (el) s.loc = locate(el); return s.loc; }),
      info: info_,
      clear,
      hide: v => { host.style.display = v ? 'none' : ''; },
      done: res => {
        busy = false;
        if (res.ok) showToast(`저장됨 · ${res.px}px\n${res.filename}`);
        else showToast('캡처 실패: ' + (res.error || '알 수 없음'), true);
        draw();
      },
      destroy: () => {
        clearInterval(urlTimer);
        for (const [t, f, o] of listeners) removeEventListener(t, f, o);
        host.remove();
      },
    };
  }
})();
