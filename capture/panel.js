// Side panel = the toolbar. It always works on the active tab of its own window.
const $ = id => document.getElementById(id);
const SCALES = [2, 3, 4, 6];
const LANGS = [['en-US', 'English'], ['ko-KR', '한국어'], ['ja-JP', '日本語']];
const isPanax = u => /^https:\/\/panaxgames\.com/.test(u || '');

let tabId = null, on = false, settings = null, devices = null, lastDownload = null, busy = false;
const send = msg => chrome.runtime.sendMessage(msg).catch(e => ({ ok: false, error: e.message }));

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function refresh() {
  const t = await activeTab();
  if (!t) return;
  tabId = t.id;
  const st = await send({ type: 'status', tabId });
  on = !!st.on;
  settings = st.settings;
  devices = st.devices;
  $('ver').textContent = 'v' + st.version;

  // status line
  const d = devices[settings.device];
  const langName = (LANGS.find(l => l[0] === settings.lang) || [, settings.lang])[1];
  $('status').classList.toggle('on', on);
  if (on) {
    $('stTitle').textContent = '모바일 캡처 모드';
    $('stSub').textContent = `${d.name} · ${settings.scale}x · ${langName}`;
    $('toggle').textContent = '끄기';
  } else {
    $('stTitle').textContent = isPanax(t.url) ? '일반 화면' : 'PANAX 페이지가 아님';
    $('stSub').textContent = isPanax(t.url) ? '켜면 이 탭이 휴대폰 화면으로 바뀝니다' : '아래에 PANAX 주소를 넣고 이동하세요';
    $('toggle').textContent = '켜기';
  }
  $('toggle').disabled = !isPanax(t.url) && !on;
  if (document.activeElement !== $('url')) $('url').value = t.url?.startsWith('http') ? t.url : '';
  $('capCard').classList.toggle('hide', !on);

  renderSettings();
  if (on) {
    const sel = await chrome.tabs.sendMessage(tabId, { type: 'getSel' }).catch(() => null);
    renderSel(sel);
  }
}

function renderSel(sel) {
  const n = sel?.count || 0;
  $('selCount').textContent = n ? `${n}개 블록` : '선택 없음';
  $('selPx').textContent = n ? `${sel.px} px` : '페이지에서 블록을 클릭하세요';
  $('shoot').disabled = busy || !n;
  $('clear').disabled = !n;
}

function renderSettings() {
  if (!$('device').options.length)
    for (const [k, d] of Object.entries(devices)) $('device').add(new Option(`${d.name} (${d.w}×${d.h})`, k));
  $('device').value = settings.device;
  const w = devices[settings.device].w;
  $('scale').innerHTML = '';
  for (const s of SCALES) {
    const b = document.createElement('button');
    b.textContent = `${s}x`;
    b.title = `가로 ${w * s}px`;
    b.className = s === settings.scale ? 'on' : '';
    b.onclick = () => save({ scale: s });
    $('scale').appendChild(b);
  }
  $('lang').innerHTML = '';
  for (const [code, name] of LANGS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.className = code === settings.lang ? 'on' : '';
    b.onclick = () => save({ lang: code });
    $('lang').appendChild(b);
  }
  $('hideTranslate').checked = settings.hideTranslate;
  $('original').checked = settings.original;
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
  renderSettings();
  if (on && !('hideTranslate' in patch) && !('original' in patch)) {
    $('setMsg').classList.remove('hide');
    setTimeout(() => $('setMsg').classList.add('hide'), 2500);
  }
}

function showMsg(text, err) {
  $('msg').textContent = text;
  $('msg').classList.toggle('err', !!err);
  $('msg').classList.toggle('hide', !text);
}

// ── controls ──
$('toggle').onclick = async () => {
  $('toggle').disabled = true;
  $('stSub').textContent = '전환 중…';
  const res = await send({ type: 'toggle', tabId });
  await refresh();
  if (!res?.ok) $('stSub').textContent = '실패: ' + (res?.error || '알 수 없음');
};
$('go').onclick = () => send({ type: 'go', tabId, url: $('url').value });
$('url').onkeydown = e => { if (e.key === 'Enter') $('go').click(); };
$('back').onclick = () => chrome.tabs.goBack(tabId).catch(() => {});
$('fwd').onclick = () => chrome.tabs.goForward(tabId).catch(() => {});
$('reload').onclick = () => chrome.tabs.reload(tabId).catch(() => {});
$('device').onchange = () => save({ device: $('device').value });
$('hideTranslate').onchange = () => save({ hideTranslate: $('hideTranslate').checked });
$('original').onchange = () => save({ original: $('original').checked });
$('clear').onclick = () => chrome.tabs.sendMessage(tabId, { type: 'clearSel' }).catch(() => {});
$('shoot').onclick = async () => {
  busy = true; $('shoot').disabled = true; $('shoot').textContent = '캡처 중…'; showMsg('');
  const res = await send({ type: 'capture', tabId });
  busy = false; $('shoot').textContent = '📸 캡처';
  if (!res?.ok) showMsg('캡처 실패: ' + (res?.error || '알 수 없음'), true);
  refresh();
};
$('showFile').onclick = () => lastDownload != null && chrome.downloads.show(lastDownload);
$('extReload').onclick = () => chrome.runtime.reload();

// ── live updates ──
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'sel' && sender.tab?.id === tabId) renderSel(msg);
  if (msg.type === 'state' && msg.tabId === tabId) refresh();
  if (msg.type === 'captured' && msg.tabId === tabId) {
    lastDownload = msg.downloadId;
    $('shotImg').src = msg.dataUrl;
    $('shotMeta').textContent = `${msg.px}px · ${msg.filename.replace(/^PANAX_capture\//, '')}`;
    $('noShot').classList.add('hide');
    $('shotBox').classList.remove('hide');
  }
});
chrome.tabs.onActivated.addListener(refresh);
// opening / resizing this panel changes the tab's width → re-center the phone
const relayout = async () => send({ type: 'relayout', windowId: (await chrome.windows.getCurrent()).id });
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relayout, 150); });
relayout();
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && (info.url || info.status === 'complete')) refresh(); });
chrome.storage.onChanged.addListener(refresh);

refresh();
