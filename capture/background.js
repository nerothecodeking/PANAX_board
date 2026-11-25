// PANAX capture — background service worker
//
// "Capture mode" is applied to an ordinary tab: through chrome.debugger the tab gets a phone viewport,
// a fixed device pixel ratio (= capture scale) and the capture language. The user browses that same tab,
// selects blocks (content.js) and presses capture; Page.captureScreenshot cuts a full-width strip.
// The side panel (panel.html) is the toolbar.

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const AND_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// Same sizes as the Chrome DevTools device list
const DEVICES = {
  iphone16promax: { name: 'iPhone 16 Pro Max', w: 440, h: 956, ua: IOS_UA },
  iphone14promax: { name: 'iPhone 14 Pro Max', w: 430, h: 932, ua: IOS_UA },
  iphone12pro:    { name: 'iPhone 12 Pro',     w: 390, h: 844, ua: IOS_UA },
  iphonexr:       { name: 'iPhone XR',         w: 414, h: 896, ua: IOS_UA },
  iphonese:       { name: 'iPhone SE',         w: 375, h: 667, ua: IOS_UA },
  pixel7:         { name: 'Pixel 7',           w: 412, h: 915, ua: AND_UA },
  galaxys20ultra: { name: 'Galaxy S20 Ultra',  w: 412, h: 915, ua: AND_UA },
  galaxys8plus:   { name: 'Galaxy S8+',        w: 360, h: 740, ua: AND_UA },
};
const DEFAULTS = { device: 'iphone16promax', scale: 3, lang: 'en-US', hideTranslate: true, original: true };
const PANAX_HOME = 'https://panaxgames.com/';
const PANEL_W = 360;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── state (service worker can be killed at any time, so it lives in storage.session) ──
const getState = async () => ({ tabs: [], ...(await chrome.storage.session.get('st')).st });
const setState = async patch => chrome.storage.session.set({ st: { ...(await getState()), ...patch } });
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings });
const isOn = async tabId => (await getState()).tabs.includes(tabId);
const tabAlive = async id => id != null && !!(await chrome.tabs.get(id).catch(() => null));
const device = s => DEVICES[s.device] || DEVICES[DEFAULTS.device];

// ── debugger / emulation ──
async function attach(tabId) {
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (e) { if (!/already attached/i.test(e.message)) throw e; }
}
const cmd = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

// height 0 = follow the window. DPR = capture scale, so srcset already picks the big images
// (a DPR override does not zoom the on-screen view, only the pixel density).
// positionX centers the phone in a wide tab; it is set to 0 while a screenshot is taken.
async function metrics(tabId, s, center = true) {
  const d = device(s);
  const tab = await chrome.tabs.get(tabId);
  const base = { width: d.w, height: 0, deviceScaleFactor: s.scale, mobile: true };
  const positionX = center ? Math.max(0, Math.round(((tab.width || d.w) - d.w) / 2)) : 0;
  if (!positionX) return cmd(tabId, 'Emulation.setDeviceMetricsOverride', base);
  // Chrome rejects a view position outside the emulated screen ("View position should be on the
  // screen"), and the screen size defaults to 0 — so give it a screen as big as the tab.
  // If centering is refused anyway, fall back to the left-aligned view rather than failing.
  try {
    await cmd(tabId, 'Emulation.setDeviceMetricsOverride', {
      ...base, positionX, positionY: 0, screenWidth: Math.max(tab.width, d.w), screenHeight: Math.max(tab.height || 0, d.h),
    });
  } catch {
    await cmd(tabId, 'Emulation.setDeviceMetricsOverride', base);
  }
}

async function emulate(tabId, s) {
  await attach(tabId);
  await metrics(tabId, s);
  const d = device(s);
  const base = s.lang.split('-')[0];
  await cmd(tabId, 'Emulation.setUserAgentOverride', { userAgent: d.ua, acceptLanguage: `${s.lang},${base};q=0.9` });
  await cmd(tabId, 'Emulation.setLocaleOverride', {}).catch(() => {});
  await cmd(tabId, 'Emulation.setLocaleOverride', { locale: s.lang }).catch(() => {});
  await cmd(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

async function enable(tabId, url) {
  await emulate(tabId, await getSettings());
  const st = await getState();
  if (!st.tabs.includes(tabId)) await setState({ tabs: [...st.tabs, tabId] });
  if (url) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.reload(tabId);       // UA / language only apply to a fresh load
  broadcast(tabId);
}

async function disable(tabId) {
  const st = await getState();
  await setState({ tabs: st.tabs.filter(t => t !== tabId) });
  await chrome.debugger.detach({ tabId }).catch(() => {});
  if (await tabAlive(tabId)) await chrome.tabs.reload(tabId);
  broadcast(tabId);
}

// tell the panel something changed for this tab
const broadcast = tabId => chrome.runtime.sendMessage({ type: 'state', tabId }).catch(() => {});

function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return PANAX_HOME;
  if (/^\d+$/.test(u)) return PANAX_HOME + u;                 // bare post id
  if (!/^https?:\/\//.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  return u;
}

// from the board: reuse the capture window if it's still open, else make one sized phone + panel
async function openWindow(url) {
  url = normalizeUrl(url);
  const st = await getState();
  if (await tabAlive(st.winTab) && st.tabs.includes(st.winTab)) {
    await chrome.tabs.update(st.winTab, { url, active: true });
    const t = await chrome.tabs.get(st.winTab);
    await chrome.windows.update(t.windowId, { focused: true });
    return;
  }
  const d = device(await getSettings());
  const cur = await chrome.windows.getLastFocused().catch(() => null);
  const width = d.w + PANEL_W + 30;
  const height = Math.min(1040, cur?.height || 1040);
  const left = cur ? Math.max(0, cur.left + cur.width - width) : 0;
  const win = await chrome.windows.create({ url: 'about:blank', type: 'normal', width, height, left, top: cur?.top ?? 0 });
  const tabId = win.tabs[0].id;
  await setState({ winTab: tabId });
  await enable(tabId, url);
  chrome.sidePanel.open({ windowId: win.id }).catch(() => {});   // may need a click on the icon instead
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const st = await getState();
  if (st.tabs.includes(tabId)) await setState({ tabs: st.tabs.filter(t => t !== tabId) });
});

// keep the phone centered when the window or the side panel changes width
async function relayout(windowId) {
  const s = await getSettings();
  for (const tabId of (await getState()).tabs) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t && !capturing.has(tabId) && (windowId == null || t.windowId === windowId)) await metrics(tabId, s).catch(() => {});
  }
}
chrome.windows.onBoundsChanged.addListener(w => relayout(w.id));

// user pressed "Cancel" on the debugging banner
chrome.debugger.onDetach.addListener(async src => {
  const st = await getState();
  if (!st.tabs.includes(src.tabId)) return;
  await setState({ tabs: st.tabs.filter(t => t !== src.tabId) });
  chrome.tabs.sendMessage(src.tabId, { type: 'off' }).catch(() => {});
  broadcast(src.tabId);
});

// settings changed in the panel → re-emulate and reload every capture tab
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const o = changes.settings.oldValue || {}, n = changes.settings.newValue || {};
  if (o.device === n.device && o.scale === n.scale && o.lang === n.lang) return;  // e.g. hideTranslate only
  const s = await getSettings();
  for (const tabId of (await getState()).tabs) {
    if (!(await tabAlive(tabId))) continue;
    await emulate(tabId, s);
    chrome.tabs.reload(tabId).catch(() => {});
  }
});

// ── capture ──
// Flow: prepare (content: find blocks, originals, hide bars → strip height) → if the strip is taller than
// the window, make the emulated viewport that tall (a real viewport, so feeds render every post in it and
// lazy images load) → measure (content: scroll strip to the top, load images, final box) → screenshot
// of that box (document coordinates, all inside the viewport) → always restore, even on failure.
const MAX_PX = 16000;              // GPU texture limit is ~16384 device px per side
const capturing = new Set();       // one capture per tab at a time

async function capture(tabId) {
  if (capturing.has(tabId)) throw new Error('이미 캡처 중');
  capturing.add(tabId);
  const s = await getSettings();
  const d = device(s);
  let prep, data;
  try {
    if (!(await isOn(tabId))) throw new Error('이 탭은 캡처 모드가 아님');
    await emulate(tabId, s);                 // re-applies if the debugger was detached and re-attached
    await metrics(tabId, s, false);          // no centering offset while capturing
    const ask = async msg => {
      const r = await chrome.tabs.sendMessage(tabId, msg).catch(e => ({ ok: false, error: '페이지와 연결 안 됨: ' + e.message }));
      if (!r?.ok) throw new Error(r?.error || '페이지 응답 없음');
      return r;
    };
    const p1 = await ask({ type: 'prepare', hideTranslate: s.hideTranslate, original: s.original });
    const need = Math.ceil(p1.h);
    if (need * s.scale > MAX_PX)
      throw new Error(`너무 깁니다 (세로 ${need * s.scale}px, 최대 ${MAX_PX}px). 배율을 낮추거나 블록을 나눠 찍으세요`);
    if (need > p1.vh)
      await cmd(tabId, 'Emulation.setDeviceMetricsOverride', { width: d.w, height: need, deviceScaleFactor: s.scale, mobile: true });
    prep = await ask({ type: 'measure' });
    if (prep.h * s.scale > MAX_PX) throw new Error('너무 깁니다. 배율을 낮추거나 블록을 나눠 찍으세요');
    data = (await cmd(tabId, 'Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { x: 0, y: prep.y, width: prep.w, height: prep.h, scale: 1 },
    })).data;
  } finally {
    await metrics(tabId, s).catch(() => {});
    await chrome.tabs.sendMessage(tabId, { type: 'restore' }).catch(() => {});
    capturing.delete(tabId);
  }
  const filename = `PANAX_capture/${slug(prep.title)}_${stamp()}.png`;
  const dataUrl = 'data:image/png;base64,' + data;
  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
  const res = { ok: true, filename, downloadId, px: `${Math.round(prep.w * s.scale)}×${Math.round(prep.h * s.scale)}` };
  chrome.runtime.sendMessage({ type: 'captured', tabId, dataUrl, ...res }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: 'captured', ...res }).catch(() => {});
  return res;
}

function slug(t) {
  return (t || 'panax').replace(/\s*\|\s*PANAX\s*$/i, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'panax';
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ── messages (content script + side panel) ──
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const tabId = msg.tabId ?? sender.tab?.id;
    switch (msg.type) {
      case 'hello':
        return { on: await isOn(tabId) };
      case 'status':
        return { on: await isOn(tabId), settings: await getSettings(), devices: DEVICES, version: chrome.runtime.getManifest().version };
      case 'toggle':
        if (await isOn(tabId)) await disable(tabId); else await enable(tabId);
        return { ok: true };
      case 'go':
        await chrome.tabs.update(tabId, { url: normalizeUrl(msg.url) });
        return { ok: true };
      case 'capture':
        try { return await capture(tabId); }
        catch (e) {
          chrome.tabs.sendMessage(tabId, { type: 'captured', ok: false, error: e.message }).catch(() => {});
          return { ok: false, error: e.message };
        }
      case 'relayout':
        await relayout(msg.windowId);
        return { ok: true };
      case 'openPanel':
        await chrome.sidePanel.open({ tabId }).catch(() => {});
        return { ok: true };
    }
  })().then(reply, e => reply({ ok: false, error: e.message }));
  return true;
});

// from the PANAX board (externally_connectable)
chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  (async () => {
    if (msg?.type === 'ping') return { ok: true, version: chrome.runtime.getManifest().version };
    if (msg?.type === 'open') { await openWindow(msg.url); return { ok: true }; }
    return { ok: false, error: 'unknown message' };
  })().then(reply, e => reply({ ok: false, error: e.message }));
  return true;
});
