const { app, BaseWindow, WebContentsView, Menu, ipcMain, session, shell, clipboard, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const crypto = require('node:crypto');

app.setName('Northstar');
app.setPath('userData', path.join(app.getPath('appData'), 'northstar-browser'));

let win;
let chrome;
const tabs = new Map();
const recentlyClosed = [];
const recentVisits = [];
const downloadItems = new Map();
const pendingSavePaths = new Map();
const permissionDecisions = new Map();
let activeId = null;
let nextId = 1;
let chromeHeight = 128;
let chromeExpanded = false;
let searchEngine = 'google';
let theme = 'system';
let doNotTrack = false;
let restoreSession = true;
let homePageUrl = '';
let chromeDensity = 'comfortable';
let chromeTextScale = 100;
let profiles = [{ id: 'default', name: 'Andrew', avatar: 'A', accent: '#596fe9' }];
let activeProfileId = 'default';
const safeMode = process.argv.includes('--safe-mode');
let sessionSaveTimer;
let tabsUpdateTimer;
const configuredSessions = new WeakSet();
const searchUrls = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q='
};
const startPagePath = path.join(__dirname, 'start.html');
const errorPagePath = path.join(__dirname, 'error.html');
const startPageUrl = pathToFileURL(startPagePath).href;

function profileDirectory(id = activeProfileId) { return path.join(app.getPath('userData'), 'profiles', id); }
function profilePartition(id = activeProfileId, isPrivate = false) {
  if (id === 'default') return isPrivate ? 'northstar-private' : 'persist:northstar';
  return isPrivate ? `northstar-private-${id}` : `persist:northstar-profile-${id}`;
}
function activeProfile() { return profiles.find(profile => profile.id === activeProfileId) || profiles[0]; }
function saveProfiles() {
  const root = app.getPath('userData'); fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, 'profiles.json'); const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ activeProfileId, profiles }, null, 2)); fs.renameSync(temp, target);
}
function loadProfiles() {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'profiles.json'), 'utf8'));
    const valid = Array.isArray(saved.profiles) ? saved.profiles.filter(p => p && /^[a-z0-9-]{4,64}$/i.test(p.id) && typeof p.name === 'string').slice(0, 20) : [];
    if (valid.length) profiles = valid.map(p => ({ id: p.id, name: p.name.slice(0, 32) || 'Profile', avatar: ['A','✦','☀','🌙','🧭'].includes(p.avatar) ? p.avatar : p.name[0].toUpperCase(), accent: /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '#596fe9' }));
    if (!profiles.some(p => p.id === 'default')) profiles.unshift({ id: 'default', name: 'Andrew', avatar: 'A', accent: '#596fe9' });
    if (profiles.length > 20) profiles = profiles.slice(0, 20);
    activeProfileId = profiles.some(p => p.id === saved.activeProfileId) ? saved.activeProfileId : profiles[0].id;
  } catch { saveProfiles(); }
}
function loadProfileData() {
  restoreSession = true; homePageUrl = ''; searchEngine = 'google'; theme = 'system'; doNotTrack = false; chromeDensity = 'comfortable'; chromeTextScale = 100; chromeHeight = 128; recentlyClosed.length = 0; recentVisits.length = 0; permissionDecisions.clear();
  try {
    const sessionPath = path.join(profileDirectory(), 'session.json');
    const legacyPath = path.join(app.getPath('userData'), 'session.json');
    const saved = JSON.parse(fs.readFileSync(fs.existsSync(sessionPath) ? sessionPath : activeProfileId === 'default' ? legacyPath : sessionPath, 'utf8'));
    if (typeof saved.restoreSession === 'boolean') restoreSession = saved.restoreSession;
    if (typeof saved.homePageUrl === 'string' && /^https?:\/\//i.test(saved.homePageUrl)) homePageUrl = saved.homePageUrl;
    if (searchUrls[saved.searchEngine]) searchEngine = saved.searchEngine;
    if (['system','light','dark'].includes(saved.theme)) theme = saved.theme;
    if (typeof saved.doNotTrack === 'boolean') doNotTrack = saved.doNotTrack;
    if (['comfortable','compact'].includes(saved.chromeDensity)) chromeDensity = saved.chromeDensity;
    if ([90,100,110].includes(saved.chromeTextScale)) chromeTextScale = saved.chromeTextScale;
    chromeHeight = Math.round((chromeDensity === 'compact' ? 108 : 128) * chromeTextScale / 100);
    if (Array.isArray(saved.recentlyClosed)) recentlyClosed.push(...saved.recentlyClosed.slice(0, 20));
    if (Array.isArray(saved.recentVisits)) recentVisits.push(...saved.recentVisits.slice(0, 20));
  } catch {}
  try {
    const permissionsPath = path.join(profileDirectory(), 'permissions.json');
    const legacyPath = path.join(app.getPath('userData'), 'permissions.json');
    Object.entries(JSON.parse(fs.readFileSync(fs.existsSync(permissionsPath) ? permissionsPath : activeProfileId === 'default' ? legacyPath : permissionsPath, 'utf8'))).forEach(([origin, value]) => permissionDecisions.set(origin, value));
  } catch {}
}

function normalize(input) {
  const value = String(input || '').trim();
  if (!value) return 'https://www.google.com';
  if (/^(https?|file):\/\//i.test(value)) return value;
  if (/^view-source:https?:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/\?#]|$)/i.test(value)) return `http://${value}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/\?#]|$)/.test(value) && !value.includes(' ')) return `https://${value}`;
  return `${searchUrls[searchEngine] || searchUrls.google}${encodeURIComponent(value)}`;
}

function tell(channel, payload) { if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send(channel, payload); }
function tellFor(tab, channel, payload) { if (tab?.profileId === activeProfileId) tell(channel, payload); }
function tabState(tab) {
  if (tab.discarded) return { id: tab.id, title: tab.restoreTitle || 'Suspended tab', url: tab.restoreUrl || '', loading: false, canGoBack: false, canGoForward: false, pinned: Boolean(tab.pinned), privateMode: tab.privateMode, audible: false, hasMedia: false, muted: false, zoom: Math.round((tab.zoom || 1) * 100), discarded: true };
  const wc = tab.view.webContents;
  return { id: tab.id, title: tab.errorFor ? 'Page unavailable' : tab.startPage ? 'New tab' : wc.getTitle() || 'New tab', url: tab.errorFor || (tab.startPage ? '' : wc.getURL()), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), pinned: Boolean(tab.pinned), privateMode: tab.privateMode, audible: wc.isCurrentlyAudible(), hasMedia: Boolean(tab.hasMedia), muted: wc.isAudioMuted(), zoom: Math.round((tab.zoom || 1) * 100) };
}
function writeSessionNow() {
  if (safeMode) return;
  try {
    const savedTabs = [...tabs.values()].filter(tab => !tab.privateMode && !tab.errorFor).slice(0, 50);
    const saved = savedTabs.map(tab => ({ url: tab.discarded ? (tab.restoreUrl || '') : tab.startPage ? '' : tab.view.webContents.getURL(), pinned: Boolean(tab.pinned), zoom: tab.zoom || 1 }));
    fs.mkdirSync(profileDirectory(), { recursive: true });
    fs.writeFileSync(path.join(profileDirectory(), 'session.json'), JSON.stringify({ tabs: saved, selected: Math.max(0, savedTabs.findIndex(tab => tab.id === activeId)), restoreSession, homePageUrl, searchEngine, theme, doNotTrack, chromeDensity, chromeTextScale, recentlyClosed: recentlyClosed.slice(0, 20), recentVisits: recentVisits.slice(0, 20) }));
  } catch (error) { console.error('Could not save Northstar session:', error); }
}
function persistSession() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(writeSessionNow, 180);
}
function savePermissionDecisions(profileId = activeProfileId, decisions = permissionDecisions) {
  try { fs.mkdirSync(profileDirectory(profileId), { recursive: true }); fs.writeFileSync(path.join(profileDirectory(profileId), 'permissions.json'), JSON.stringify(Object.fromEntries(decisions))); }
  catch (error) { console.error('Could not save site permissions:', error); }
}
function logDiagnostic(message) {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.appendFileSync(path.join(app.getPath('userData'), 'northstar.log'), `${new Date().toISOString()} ${String(message).slice(0, 500)}\n`); }
  catch (error) { console.error('Could not write Northstar diagnostics:', error); }
}
function sendTabs() {
  clearTimeout(tabsUpdateTimer);
  tabsUpdateTimer = setTimeout(() => tell('tabs:changed', { tabs: [...tabs.values()].map(tabState), activeId, recentlyClosed: recentlyClosed.slice(0, 5) }), 16);
  persistSession();
}
function updateStartPages() {
  const items = recentVisits.slice(0, 5);
  for (const tab of tabs.values()) if (tab.startPage && !tab.privateMode && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.executeJavaScript(`window.northstarUpdateRecent?.(${JSON.stringify(items)})`).catch(() => {});
  }
}
async function confirmExternal(rawUrl) {
  let target;
  try { target = new URL(String(rawUrl)); } catch { tell('toast', 'That external address is invalid'); return; }
  if (!['mailto:', 'tel:', 'sms:'].includes(target.protocol)) { tell('toast', 'This link type is not allowed'); return; }
  const answer = await dialog.showMessageBox(win, { type: 'question', title: 'Open external app?', message: `Open this link with another app?`, detail: target.href, buttons: ['Open app', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
  if (answer.response === 0) shell.openExternal(target.href).catch(error => tell('toast', error.message));
}
function layout() {
  if (!win || !activeId) return;
  const { width, height } = win.getContentBounds();
  const view = tabs.get(activeId)?.view;
  if (view) view.setBounds({ x: 0, y: chromeHeight, width, height: Math.max(0, height - chromeHeight) });
  chrome.setBounds({ x: 0, y: 0, width, height: chromeExpanded ? Math.min(height, 600) : chromeHeight });
  win.contentView.removeChildView(chrome);
  win.contentView.addChildView(chrome);
}
function activate(id) {
  if (!tabs.has(id)) return;
  let tab = tabs.get(id);
  if (tab.discarded) {
    const items = [...tabs.entries()]; const index = items.findIndex(([tabId]) => tabId === id);
    const replacementId = createTab(tab.restoreUrl || null, false, tab.privateMode, false);
    const replacement = tabs.get(replacementId); replacement.pinned = tab.pinned; replacement.zoom = tab.zoom;
    tabs.delete(id);
    const ordered = [...tabs.entries()]; ordered.splice(index, 0, [replacementId, replacement]);
    tabs.clear(); ordered.forEach(entry => tabs.set(...entry));
    id = replacementId; tab = replacement;
  }
  if (activeId && tabs.has(activeId) && tabs.get(activeId).view) win.contentView.removeChildView(tabs.get(activeId).view);
  activeId = id;
  win.contentView.addChildView(tab.view);
  tab.view.webContents.setZoomFactor(tab.zoom || 1);
  layout();
  sendTabs();
  tell('tab:active', tabState(tab));
  if (win) win.setTitle(`${tab.view.webContents.getTitle() || 'New tab'} — Northstar`);
}
function configureSession(browserSession) {
  if (configuredSessions.has(browserSession)) return;
  configuredSessions.add(browserSession);
  const ownerProfileId = activeProfileId;
  const sessionPermissionDecisions = new Map(permissionDecisions);
  browserSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if (doNotTrack) requestHeaders.DNT = '1';
    callback({ requestHeaders });
  });
  browserSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const sensitive = new Set(['geolocation', 'notifications', 'media', 'camera', 'microphone', 'clipboard-read']);
    if (!sensitive.has(permission) || !win) { callback(false); return; }
    const ownerTab = [...tabs.values()].find(tab => tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === contents.id);
    if (!ownerTab || ownerTab.profileId !== ownerProfileId) { callback(false); return; }
    let site = 'This website';
    try { site = new URL(details?.requestingUrl || contents.getURL()).hostname || site; } catch {}
    let origin = '';
    try { origin = new URL(details?.requestingUrl || contents.getURL()).origin; } catch {}
    const privateTab = ownerTab.privateMode;
    const stored = sessionPermissionDecisions.get(origin)?.[permission];
    if (!privateTab && typeof stored === 'boolean') { callback(stored); return; }
    const label = permission === 'media' ? 'camera and microphone' : permission.replace('-', ' ');
    try {
      const answer = await dialog.showMessageBox(win, { type: 'question', title: 'Site permission', message: `${site} wants to use ${label}.`, buttons: ['Allow once', 'Always allow', 'Always block', 'Cancel'], defaultId: 3, cancelId: 3, noLink: true });
      if (!privateTab && origin && (answer.response === 1 || answer.response === 2)) {
        sessionPermissionDecisions.set(origin, { ...sessionPermissionDecisions.get(origin), [permission]: answer.response === 1 });
        if (ownerProfileId === activeProfileId) permissionDecisions.set(origin, sessionPermissionDecisions.get(origin));
        savePermissionDecisions(ownerProfileId, sessionPermissionDecisions);
      }
      callback(answer.response === 0 || answer.response === 1);
    } catch { callback(false); }
  });
  browserSession.on('will-download', (_event, item) => {
    const filename = item.getFilename();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const customPathKey = `${ownerProfileId}:${item.getURL()}`; const customPath = pendingSavePaths.get(customPathKey);
    if (customPath) { item.setSavePath(customPath); pendingSavePaths.delete(customPathKey); }
    downloadItems.set(id, item);
    while (downloadItems.size > 100) downloadItems.delete(downloadItems.keys().next().value);
    if (ownerProfileId === activeProfileId) tell('download:started', { id, filename, total: item.getTotalBytes() });
    let previous = { received: 0, time: Date.now() };
    item.on('updated', (_e, state) => {
      const received = item.getReceivedBytes(); const total = item.getTotalBytes(); const now = Date.now();
      const rate = (received - previous.received) / Math.max(.1, (now - previous.time) / 1000);
      const remaining = rate > 0 && total > received ? Math.ceil((total - received) / rate * 1000) : null;
      previous = { received, time: now };
      if (ownerProfileId === activeProfileId) tell('download:progress', { id, filename, received, total, remaining, state, paused: item.isPaused() });
    });
    item.once('done', (_e, state) => { if (ownerProfileId === activeProfileId) tell('download:done', { id, filename, state, path: item.getSavePath() }); });
  });
}

function createTab(url = null, activateNow = true, privateMode = null, useHomePage = true) {
  const id = nextId++;
  const initialUrl = url || (useHomePage ? homePageUrl : '') || null;
  const isPrivate = privateMode === null ? Boolean(tabs.get(activeId)?.privateMode) : Boolean(privateMode);
  const partition = profilePartition(activeProfileId, isPrivate);
  const browserSession = session.fromPartition(partition);
  configureSession(browserSession);
  const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, sandbox: true } });
  const tab = { id, view, startPage: !initialUrl, errorFor: null, privateMode: isPrivate, zoom: 1, profileId: activeProfileId };
  tabs.set(id, tab);
  const wc = view.webContents;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(); const command = input.control || input.meta;
    if (input.alt && input.key === 'ArrowLeft') { event.preventDefault(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return; }
    if (input.alt && input.key === 'ArrowRight') { event.preventDefault(); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return; }
    if (input.alt && input.key === 'Home') { event.preventDefault(); if (activeId === id) { tab.errorFor = null; if (homePageUrl) { tab.startPage = false; wc.loadURL(homePageUrl); } else { tab.startPage = true; wc.loadFile(startPagePath, { query: { engine: searchEngine, theme, recent: tab.privateMode ? '[]' : JSON.stringify(recentVisits.slice(0, 5)) } }); } } return; }
    if (!command) return;
    if (key === 'f') { event.preventDefault(); tell('find:open'); }
    if (key === 'l') { event.preventDefault(); tell('omnibox:focus'); }
    if (key === 't') { event.preventDefault(); if (input.shift) { const closed = recentlyClosed.shift(); if (closed) createTab(closed.url); } else createTab(); }
    if (key === 'w') { event.preventDefault(); closeTab(id); }
    if (key === 'r') { event.preventDefault(); wc.reload(); }
    if (key === 'p') { event.preventDefault(); wc.print(); }
    if (key === 'j') { event.preventDefault(); if (activeId === id) tell('downloads:open'); }
    if (key === '+' || key === '=' || key === '-' || key === '0') {
      event.preventDefault(); tab.zoom = key === '0' ? 1 : Math.max(.5, Math.min(2, (tab.zoom || 1) + (key === '-' ? -.1 : .1))); wc.setZoomFactor(tab.zoom); sendTabs();
    }
    if (key === 'h') { event.preventDefault(); tell('history:open'); }
    if (key === 'd') { event.preventDefault(); if (activeId === id) tell('bookmark:toggle'); }
  });
  wc.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) createTab(target, true, tab.privateMode);
    else confirmExternal(target);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_event, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => createTab(params.linkURL, true, tab.privateMode) });
      items.push({ label: 'Open link in background tab', click: () => createTab(params.linkURL, false, tab.privateMode) });
      items.push({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.selectionText) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Copy selected text', click: () => clipboard.writeText(params.selectionText) });
      items.push({ label: 'Search for “' + params.selectionText.slice(0, 48) + '”', click: () => createTab(normalize(params.selectionText), true, tab.privateMode) });
    }
    if (params.srcURL && params.mediaType === 'image') {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Open image in new tab', click: () => createTab(params.srcURL, true, tab.privateMode) });
      items.push({ label: 'Save image as…', click: async () => {
        const suggestion = path.basename(new URL(params.srcURL).pathname) || 'image';
        const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), suggestion) });
        if (!result.canceled && result.filePath) { pendingSavePaths.set(`${activeProfileId}:${params.srcURL}`, result.filePath); wc.downloadURL(params.srcURL); }
      } });
    }
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'View page source', click: () => createTab(`view-source:${wc.getURL()}`, true, tab.privateMode) });
    items.push({ label: 'Inspect page', click: () => wc.openDevTools({ mode: 'detach' }) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  wc.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url) && !/^view-source:https?:/i.test(url) && !url.startsWith('file:')) { event.preventDefault(); confirmExternal(url); return; }
    if (url.startsWith('file:')) return;
    tab.startPage = false;
    tab.errorFor = null;
    tab.hasMedia = false;
    if (!tab.privateMode) {
      const entry = { url, title: wc.getTitle() || url, time: Date.now() };
      recentVisits.unshift(entry);
      for (let i = recentVisits.length - 1; i > 0; i--) if (recentVisits[i].url === url) recentVisits.splice(i, 1);
      recentVisits.splice(20);
      tellFor(tab, 'history:add', entry);
      updateStartPages();
    }
  });
  wc.on('page-title-updated', () => {
    if (activeId === id && win) win.setTitle(`${wc.getTitle() || 'New tab'} — Northstar`);
    sendTabs();
  });
  wc.on('found-in-page', (_event, result) => tellFor(tab, 'find:result', { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches }));
  wc.on('did-finish-load', () => {
    if (tab.startPage) {
      wc.executeJavaScript(`window.northstarApplySettings?.(${JSON.stringify({ searchEngine, theme })})`).catch(() => {});
      wc.executeJavaScript(`window.northstarUpdateRecent?.(${JSON.stringify(tab.privateMode ? [] : recentVisits.slice(0, 5))})`).catch(() => {});
    }
    sendTabs();
  });
  wc.on('did-navigate', (_event, url) => { tab.startPage = url.split('?')[0] === startPageUrl; if (!tab.startPage && !tab.errorFor) tab.errorFor = null; sendTabs(); });
  wc.on('did-navigate-in-page', sendTabs);
  wc.on('did-start-loading', sendTabs);
  wc.on('did-stop-loading', sendTabs);
  wc.on('media-started-playing', () => { tab.hasMedia = true; sendTabs(); });
  wc.on('media-paused', () => { tab.hasMedia = true; sendTabs(); });
  wc.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || tab.startPage || !url || url.startsWith('file:')) return;
    tab.errorFor = url;
    logDiagnostic(`Navigation failed (${errorCode}): ${description || 'unknown error'}`);
    wc.loadFile(errorPagePath, { query: { url, error: description || 'The connection could not be completed.', code: errorCode } });
  });
  wc.on('render-process-gone', (_event, details) => { logDiagnostic(`Renderer stopped: ${details.reason}`); tab.crashed = true; if (activeId === id) tellFor(tab, 'tab:crashed'); sendTabs(); });
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  if (activateNow) activate(id);
  if (initialUrl) wc.loadURL(normalize(initialUrl));
  else wc.loadFile(startPagePath, { query: { engine: searchEngine, theme, recent: tab.privateMode ? '[]' : JSON.stringify(recentVisits.slice(0, 5)) } });
  sendTabs();
  return id;
}
function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const index = ids.indexOf(id);
  const url = tab.discarded ? tab.restoreUrl : tab.errorFor || (tab.startPage ? null : tab.view.webContents.getURL());
  if (url && !url.startsWith('file:') && !tab.privateMode) {
    recentlyClosed.unshift({ url, title: tab.view.webContents.getTitle() || url, pinned: Boolean(tab.pinned), privateMode: false });
    recentlyClosed.splice(20);
  }
  tabs.delete(id);
  if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (activeId === id) {
    activeId = null;
    if (tabs.size) activate(ids[index + 1] || ids[index - 1]);
    else createTab();
  }
  sendTabs();
}

function attachChromeShortcuts() {
  chrome.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'm' && input.alt) { event.preventDefault(); tell('media:toggle'); return; }
    if (key === 'f' && (input.control || input.meta)) { event.preventDefault(); tell('find:open'); return; }
    if (input.alt && input.key === 'Home') { event.preventDefault(); tell('home:open'); return; }
    if (!input.control && !input.meta) return;
    if (key === 'l') { event.preventDefault(); tell('omnibox:focus'); }
    if (key === 't') {
      event.preventDefault();
      if (input.shift) { const closed = recentlyClosed.shift(); if (closed) { const id = createTab(closed.url); tabs.get(id).pinned = closed.pinned; sendTabs(); } }
      else createTab();
    }
    if (key === 'n' && input.shift) { event.preventDefault(); createTab(null, true, true); }
    if (key === 'w') { event.preventDefault(); closeTab(activeId); }
    if (key === 'r') { event.preventDefault(); tabs.get(activeId)?.view?.webContents.reload(); }
    if (key === 'p') { event.preventDefault(); tabs.get(activeId)?.view?.webContents.print(); }
    if (key === 'j') { event.preventDefault(); tell('downloads:open'); }
    if (['+', '=', '-', '0'].includes(key)) { event.preventDefault(); const tab = tabs.get(activeId); const wc = tab?.view?.webContents; if (tab && wc) { tab.zoom = key === '0' ? 1 : Math.max(.5, Math.min(2, (tab.zoom || 1) + (key === '-' ? -.1 : .1))); wc.setZoomFactor(tab.zoom); sendTabs(); } }
    if (key === 'd') { event.preventDefault(); tell('bookmark:toggle'); }
    if (key === 'h') { event.preventDefault(); tell('history:open'); }
    if (input.key === 'Tab') { event.preventDefault(); const ids = [...tabs.keys()]; const i = ids.indexOf(activeId); activate(ids[(i + (input.shift ? -1 : 1) + ids.length) % ids.length]); }
  });
}
function createChromeView() {
  chrome = new WebContentsView({ webPreferences: { partition: profilePartition(), preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  chrome.setBackgroundColor('#00000000');
  win.contentView.addChildView(chrome);
  chrome.webContents.loadFile(path.join(__dirname, 'index.html'));
  attachChromeShortcuts();
}
function restoreProfileTabs() {
  configureSession(session.fromPartition(profilePartition()));
  let restored = false;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(profileDirectory(), 'session.json'), 'utf8'));
    if (restoreSession && !safeMode && Array.isArray(saved.tabs)) {
      const entries = saved.tabs.filter(item => !item.url || /^https?:/i.test(item.url)).slice(0, 50);
      for (const item of entries) {
        const id = createTab(item.url || null, false, false, false); const tab = tabs.get(id);
        tab.pinned = Boolean(item.pinned); tab.zoom = Math.max(.5, Math.min(2, Number(item.zoom) || 1)); tab.view.webContents.setZoomFactor(tab.zoom);
      }
      if (tabs.size) { activate([...tabs.keys()][Math.min(Number(saved.selected) || 0, tabs.size - 1)]); restored = true; }
    }
  } catch {}
  if (!restored) createTab();
}
function switchProfile(id) {
  if (!profiles.some(profile => profile.id === id) || id === activeProfileId || !win) return false;
  clearTimeout(sessionSaveTimer); clearTimeout(tabsUpdateTimer);
  writeSessionNow();
  for (const tab of tabs.values()) {
    if (tab.view) { try { win.contentView.removeChildView(tab.view); } catch {} if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); }
  }
  tabs.clear(); activeId = null;
  if (chrome) { try { win.contentView.removeChildView(chrome); } catch {} if (!chrome.webContents.isDestroyed()) chrome.webContents.close(); }
  activeProfileId = id; saveProfiles(); loadProfileData();
  createChromeView(); restoreProfileTabs();
  return true;
}
function createWindow() {
  win = new BaseWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 520, backgroundColor: '#f4f5f7', title: 'Northstar' });
  createChromeView(); restoreProfileTabs();
  win.on('resize', layout);
  win.on('focus', () => { if (activeId && tabs.has(activeId)) activate(activeId); });
  win.on('close', persistSession);
  win.on('closed', () => {
    for (const tab of tabs.values()) if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tabs.clear(); if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.close();
    win = null; chrome = null; activeId = null;
  });
}

ipcMain.handle('browser:command', async (event, action, value) => {
  if (!chrome || event.sender !== chrome.webContents) throw new Error('Untrusted browser command sender');
  const tab = tabs.get(activeId); const wc = tab?.view.webContents;
  if (action === 'create-profile') {
    const name = String(value?.name || '').trim().slice(0, 32);
    if (!name || profiles.length >= 20 || profiles.some(profile => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return { ok: false, error: 'Choose a unique profile name (up to 20 profiles).' };
    const profile = { id: crypto.randomUUID(), name, avatar: ['A','✦','☀','🌙','🧭'].includes(value?.avatar) ? value.avatar : name[0].toUpperCase(), accent: '#596fe9' };
    profiles.push(profile); fs.mkdirSync(profileDirectory(profile.id), { recursive: true }); saveProfiles();
    return { ok: true, profile };
  }
  if (action === 'switch-profile') return { ok: switchProfile(String(value || '')) };
  if (action === 'delete-profile') {
    const id = String(value || '');
    if (id === 'default' || id === activeProfileId) return { ok: false };
    const index = profiles.findIndex(profile => profile.id === id); if (index < 0) return { ok: false };
    try { const normal = session.fromPartition(profilePartition(id)); const priv = session.fromPartition(profilePartition(id, true)); await Promise.all([normal.clearStorageData(), normal.clearCache(), priv.clearStorageData(), priv.clearCache()]); } catch {}
    profiles.splice(index, 1); fs.rmSync(profileDirectory(id), { recursive: true, force: true }); saveProfiles();
    tell('profiles:changed', { profiles, activeProfileId }); return { ok: true };
  }
  if (action === 'navigate') { if (tab) { tab.startPage = false; tab.errorFor = null; } wc?.loadURL(normalize(value)); }
  if (action === 'home' && wc) { tab.errorFor = null; if (homePageUrl) { tab.startPage = false; wc.loadURL(homePageUrl); } else { tab.startPage = true; wc.loadFile(startPagePath, { query: { engine: searchEngine, theme, recent: tab.privateMode ? '[]' : JSON.stringify(recentVisits.slice(0, 5)) } }); } }
  if (action === 'back' && wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'forward' && wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (action === 'reload') { if (tab?.errorFor) { const failedUrl = tab.errorFor; tab.errorFor = null; wc?.loadURL(failedUrl); } else wc?.reload(); }
  if (action === 'stop') wc?.stop();
  if (action === 'new-tab') createTab(value || null);
  if (action === 'activate') activate(Number(value));
  if (action === 'close') closeTab(Number(value));
  if (action === 'duplicate') {
    const source = tabs.get(Number(value)) || tab;
    if (source) { const url = source.discarded ? source.restoreUrl || null : source.errorFor || (source.startPage ? null : source.view.webContents.getURL()); const id = createTab(url, true, source.privateMode); tabs.get(id).pinned = Boolean(source.pinned); sendTabs(); }
  }
  if (action === 'pin') { const target = tabs.get(Number(value)); if (target) { target.pinned = !target.pinned; sendTabs(); } }
  if (action === 'mute') { const target = tabs.get(Number(value))?.view?.webContents; if (target) target.setAudioMuted(!target.isAudioMuted()); sendTabs(); }
  if (action === 'discard-tab') {
    const target = tabs.get(Number(value));
    if (target && target.id !== activeId && target.view && !target.view.webContents.isCurrentlyAudible()) {
      target.restoreUrl = target.errorFor || (target.startPage ? '' : target.view.webContents.getURL()); target.restoreTitle = target.view.webContents.getTitle() || 'Suspended tab'; target.discarded = true;
      target.view.webContents.close(); target.view = null; sendTabs(); tell('toast', 'Inactive tab suspended to free memory');
    } else tell('toast', target?.id === activeId ? 'Switch to another tab before suspending this one' : 'Playing media tabs stay active');
  }
  if (action === 'picture-in-picture') {
    wc?.executeJavaScript(`(() => { const videos = [...document.querySelectorAll('video')]; const video = videos.find(item => !item.paused && item.readyState > 1) || videos.find(item => item.readyState > 1); return video?.requestPictureInPicture?.(); })()`, true).catch(() => tell('toast', 'Picture in picture is not available on this page'));
  }
  if (action === 'media-toggle') {
    wc?.executeJavaScript(`(() => { const videos = [...document.querySelectorAll('video')]; const video = videos.find(item => !item.paused) || videos.find(item => item.readyState > 0); if (!video) return false; return video.paused ? video.play() : (video.pause(), true); })()`, true).then(ok => { if (!ok) tell('toast', 'No media is ready on this page'); }).catch(() => tell('toast', 'Could not control page media'));
  }
  if (action === 'close-others') { for (const id of [...tabs.keys()]) if (id !== Number(value)) closeTab(id); }
  if (action === 'reorder') {
    const order = [...tabs.entries()]; const from = order.findIndex(([id]) => id === Number(value?.from)); const to = order.findIndex(([id]) => id === Number(value?.to));
    if (from >= 0 && to >= 0 && from !== to) { const [item] = order.splice(from, 1); order.splice(to, 0, item); tabs.clear(); for (const entry of order) tabs.set(...entry); sendTabs(); }
  }
  if (action === 'restore-closed') { const index = Math.max(0, Number(value) || 0); const [closed] = recentlyClosed.splice(index, 1); if (closed) { const id = createTab(closed.url, true, closed.privateMode); tabs.get(id).pinned = closed.pinned; sendTabs(); } }
  if (action === 'new-private-tab') createTab(value || null, true, true);
  if (action === 'open-external') await confirmExternal(value);
  if (action === 'open-diagnostics') shell.openPath(path.join(app.getPath('userData'), 'northstar.log'));
  if (action === 'memory-usage') { const usage = await process.getProcessMemoryInfo(); return { workingSetMiB: Math.round(usage.workingSetSize / 1024), privateMiB: Math.round(usage.private / 1024) }; }
  if (action === 'copy-diagnostics') { const memory = await process.getProcessMemoryInfo(); const report = `Northstar ${app.getVersion()} | Electron ${process.versions.electron} | Chromium ${process.versions.chrome} | ${process.platform}\nTabs: ${tabs.size} | Private tab active: ${Boolean(tabs.get(activeId)?.privateMode)} | Safe mode: ${safeMode}\nBrowser UI working set: ${Math.round(memory.workingSetSize / 1024)} MiB`; clipboard.writeText(report); tell('toast', 'Diagnostics copied'); return report; }
  if (action === 'restart-safe-mode') { app.relaunch({ args: [...process.argv.slice(1), '--safe-mode'] }); app.quit(); return true; }
  if (action === 'site-permissions') {
    let origin = ''; try { origin = new URL(wc?.getURL() || '').origin; } catch {}
    return { origin, permissions: permissionDecisions.get(origin) || {} };
  }
  if (action === 'revoke-site-permissions') {
    let origin = ''; try { origin = new URL(wc?.getURL() || '').origin; } catch {}
    if (origin) permissionDecisions.delete(origin); savePermissionDecisions(); tell('toast', 'Saved permission choices cleared for this site'); return { origin, permissions: {} };
  }
  if (action === 'reset-browser-data') {
    for (const browserSession of [session.fromPartition(profilePartition()), session.fromPartition(profilePartition(activeProfileId, true))]) {
      await browserSession.clearCache(); await browserSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    }
    permissionDecisions.clear(); savePermissionDecisions(); restoreSession = false; homePageUrl = ''; writeSessionNow();
    tell('toast', 'Browser data cleared'); return { ok: true };
  }
  if (action === 'zoom' && wc && tab) { tab.zoom = Math.max(.5, Math.min(2, Number(value) || 1)); wc.setZoomFactor(tab.zoom); }
  if (action === 'print') wc?.print({}, (success, reason) => { if (!success) tell('toast', reason || 'Could not print this page'); });
  if (action === 'save-page' && wc) { const url = wc.getURL(); if (/^https?:/i.test(url)) wc.downloadURL(url); else tell('toast', 'Save page is available on websites'); }
  if (action === 'find') { if (value?.text) wc?.findInPage(String(value.text), value.options || {}); else wc?.stopFindInPage('clearSelection'); }
  if (action === 'overlay') { chromeExpanded = Boolean(value); layout(); }
  if (action === 'open-downloads') shell.openPath(app.getPath('downloads'));
  if (action === 'download-open') { const item = downloadItems.get(String(value)); if (item?.isDone() && item.getSavePath()) shell.openPath(item.getSavePath()); }
  if (action === 'download-reveal') { const item = downloadItems.get(String(value)); if (item?.isDone() && item.getSavePath()) shell.showItemInFolder(item.getSavePath()); }
  if (action === 'download-cancel') downloadItems.get(String(value))?.cancel();
  if (action === 'download-pause') downloadItems.get(String(value))?.pause();
  if (action === 'download-resume') downloadItems.get(String(value))?.resume();
  if (action === 'clear-site-cookies' && wc) {
    try {
      const url = new URL(wc.getURL());
      if (['http:', 'https:'].includes(url.protocol)) {
        const cookies = await wc.session.cookies.get({ url: url.origin });
        await Promise.all(cookies.map(cookie => wc.session.cookies.remove(`${url.protocol}//${cookie.domain.replace(/^\./, '')}${cookie.path}`, cookie.name)));
        tell('toast', `${cookies.length} site cookie${cookies.length === 1 ? '' : 's'} cleared`);
      }
    } catch { tell('toast', 'Could not clear cookies for this page'); }
  }
  if (action === 'clear-cache' && wc) { await wc.session.clearCache(); tell('toast', 'Cached files cleared'); }
  if (action === 'settings') {
    if (value?.searchEngine && searchUrls[value.searchEngine]) searchEngine = value.searchEngine;
    if (['system', 'light', 'dark'].includes(value?.theme)) theme = value.theme;
    if (typeof value?.doNotTrack === 'boolean') doNotTrack = value.doNotTrack;
    if (['comfortable','compact'].includes(value?.density)) chromeDensity = value.density;
    if ([90,100,110].includes(Number(value?.textScale))) chromeTextScale = Number(value.textScale);
    const profile = activeProfile();
    if (profile) {
      if (typeof value?.profileName === 'string' && value.profileName.trim()) profile.name = value.profileName.trim().slice(0, 32);
      if (['A','✦','☀','🌙','🧭'].includes(value?.profileAvatar)) profile.avatar = value.profileAvatar;
      if (/^#[0-9a-f]{6}$/i.test(value?.profileAccent || '')) profile.accent = value.profileAccent;
      saveProfiles(); tell('profiles:changed', { profiles, activeProfileId });
    }
    if (typeof value?.restoreSession === 'boolean') { restoreSession = value.restoreSession; persistSession(); }
    if (typeof value?.homePageUrl === 'string') { try { const parsed = new URL(value.homePageUrl); homePageUrl = ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { homePageUrl = ''; } persistSession(); }
    chromeHeight = Math.round((chromeDensity === 'compact' ? 108 : 128) * chromeTextScale / 100); layout(); persistSession();
    for (const item of tabs.values()) {
      if (item.startPage && !item.view.webContents.isDestroyed()) {
        item.view.webContents.executeJavaScript(`window.northstarApplySettings?.(${JSON.stringify({ searchEngine, theme })})`).catch(() => {});
      }
    }
  }
  return activeId ? tabState(tabs.get(activeId)) : null;
});
ipcMain.handle('browser:state', (event) => {
  if (!chrome || event.sender !== chrome.webContents) throw new Error('Untrusted browser state sender');
  return { tabs: [...tabs.values()].map(tabState), activeId, recentlyClosed: recentlyClosed.slice(0, 5), version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, safeMode, privateMode: Boolean(tabs.get(activeId)?.privateMode), logPath: path.join(app.getPath('userData'), 'northstar.log'), improvements: (fs.readFileSync(path.join(__dirname, 'IMPROVEMENTS.md'), 'utf8').match(/- \[x\] \d{3}\./g) || []).length, profiles, activeProfileId, activeProfile: activeProfile() };
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  loadProfiles(); loadProfileData();
  logDiagnostic(`Started Northstar ${app.getVersion()} on Electron ${process.versions.electron}, Chromium ${process.versions.chrome}${safeMode ? ' (safe mode)' : ''}`);
  createWindow();
}).catch(error => { console.error('Northstar failed to start:', error); logDiagnostic(`Startup failed: ${error.stack || error.message}`); app.exit(1); });
app.on('before-quit', writeSessionNow);
app.on('activate', () => { if (!BaseWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
