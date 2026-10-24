const $ = id => document.getElementById(id);
const address = $('address');
$('tabs').addEventListener('wheel', event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { $('tabs').scrollLeft += event.deltaY; event.preventDefault(); } }, { passive: false });
const firstRunForProfile = localStorage.getItem('northstar.preferences') === null;
const data = {
  tabs: [], activeId: null, recentlyClosed: [], profiles: [], activeProfileId: null, activeProfile: null,
  bookmarks: JSON.parse(localStorage.getItem('northstar.bookmarks') || '[]'),
  history: JSON.parse(localStorage.getItem('northstar.history') || '[]'),
  preferences: JSON.parse(localStorage.getItem('northstar.preferences') || '{"theme":"system","searchEngine":"google","doNotTrack":false,"density":"comfortable","textScale":100,"restoreSession":true,"homePageUrl":"","profileName":"Andrew","profileAvatar":"A","profileAccent":"#596fe9"}'),
  downloads: [], zoom: 100, overlay: false, contextTabId: null
};
const icons = {
  back: '<svg viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7"/></svg>',
  forward: '<svg viewBox="0 0 24 24"><path d="m9.5 5 7 7-7 7"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4.8 9a7.5 7.5 0 0 1 12.7-2L20 12M4 17v-5h5m10.2 3a7.5 7.5 0 0 1-12.7 2L4 12"/></svg>'
};
function persist() {
  localStorage.setItem('northstar.bookmarks', JSON.stringify(data.bookmarks));
  localStorage.setItem('northstar.history', JSON.stringify(data.history.slice(0, 500)));
  localStorage.setItem('northstar.preferences', JSON.stringify(data.preferences));
}
function showToast(text) {
  $('toastAction').hidden = true;
  $('toastMessage').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $('toast').classList.remove('show'), 2300);
}
function current() { return data.tabs.find(tab => tab.id === data.activeId); }
function setOverlay(enabled) {
  if (data.overlay === enabled) return;
  data.overlay = enabled;
  window.northstar.command('overlay', enabled);
}
function setPanel(panel) {
  $('menuPanel').hidden = panel !== 'menu';
  $('historyPanel').hidden = panel !== 'history';
  $('settingsPanel').hidden = panel !== 'settings';
  $('downloadsPanel').hidden = panel !== 'downloads';
  $('findBar').hidden = panel !== 'find';
  $('tabContext').hidden = true;
  $('bookmarkContext').hidden = true;
  setOverlay(panel !== null);
  if (panel === 'history') { renderHistory(); $('historySearch').focus(); }
}
function applyPreferences() {
  if (!['system', 'light', 'dark'].includes(data.preferences.theme)) data.preferences.theme = 'system';
  if (!['google', 'bing', 'duckduckgo', 'brave'].includes(data.preferences.searchEngine)) data.preferences.searchEngine = 'google';
  data.preferences.doNotTrack = Boolean(data.preferences.doNotTrack);
  if (!['comfortable', 'compact'].includes(data.preferences.density)) data.preferences.density = 'comfortable';
  document.documentElement.dataset.theme = data.preferences.theme;
  document.documentElement.dataset.density = data.preferences.density;
  if (![90, 100, 110].includes(Number(data.preferences.textScale))) data.preferences.textScale = 100;
  document.documentElement.style.zoom = String(data.preferences.textScale / 100);
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('selected', button.dataset.themeChoice === data.preferences.theme));
  document.querySelectorAll('[data-engine]').forEach(button => button.classList.toggle('selected', button.dataset.engine === data.preferences.searchEngine));
  document.querySelectorAll('[data-density]').forEach(button => button.classList.toggle('selected', button.dataset.density === data.preferences.density));
  document.querySelectorAll('[data-text-scale]').forEach(button => button.classList.toggle('selected', Number(button.dataset.textScale) === Number(data.preferences.textScale)));
  $('dntToggle').checked = data.preferences.doNotTrack;
  data.preferences.restoreSession = data.preferences.restoreSession !== false;
  $('restoreSessionToggle').checked = data.preferences.restoreSession;
  data.preferences.homePageUrl ||= '';
  data.preferences.profileName ||= 'Andrew'; data.preferences.profileAvatar ||= 'A';
  if (!/^#[0-9a-f]{6}$/i.test(data.preferences.profileAccent || '')) data.preferences.profileAccent = '#596fe9';
  $('homePageInput').value = data.preferences.homePageUrl;
  $('profileNameInput').value = data.preferences.profileName;
  $('profileAvatarInput').value = data.preferences.profileAvatar;
  $('profileAccentInput').value = data.preferences.profileAccent;
  document.documentElement.style.setProperty('--blue', data.preferences.profileAccent);
  $('profile').lastElementChild.textContent = data.preferences.profileAvatar;
  $('profileLarge').textContent = data.preferences.profileAvatar;
  $('profileWelcomeName').textContent = `Welcome, ${data.preferences.profileName}`;
  persist();
  window.northstar.command('settings', data.preferences);
}
function paintTabs() {
  const host = $('tabs');
  host.replaceChildren();
  for (const tab of data.tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === data.activeId ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.loading ? ' is-loading' : ''}${tab.audible ? ' audible' : ''}${tab.privateMode ? ' private' : ''}`;
    el.title = tab.url || tab.title;
    el.draggable = true;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === data.activeId));
    const favicon = document.createElement('span');
    favicon.className = 'favicon';
    favicon.textContent = tab.audible ? '♪' : tab.loading ? '·' : (tab.title || 'N').trim().charAt(0).toUpperCase();
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New tab';
    const close = document.createElement('button');
    close.className = 'close-tab'; close.textContent = '×'; close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
    close.onclick = event => { event.stopPropagation(); window.northstar.command('close', tab.id); };
    el.append(favicon, title, close);
    el.onclick = () => { setPanel(null); window.northstar.command('activate', tab.id); };
    el.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', String(tab.id)); event.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', event => { event.preventDefault(); window.northstar.command('reorder', { from: Number(event.dataTransfer.getData('text/plain')), to: tab.id }); });
    el.addEventListener('contextmenu', event => {
      event.preventDefault(); data.contextTabId = tab.id;
      $('tabContext').style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 190))}px`;
      $('tabContext').style.top = `${Math.min(event.clientY, window.innerHeight - 210)}px`;
      $('tabContext').querySelector('[data-tab-action="pin"]').textContent = tab.pinned ? 'Unpin tab' : 'Pin tab';
      $('tabContext').querySelector('[data-tab-action="mute"]').textContent = tab.muted ? 'Unmute tab' : 'Mute tab';
      $('tabContext').querySelector('[data-tab-action="discard"]').disabled = tab.id === data.activeId || tab.discarded;
      $('tabContext').querySelector('[data-tab-action="discard"]').textContent = tab.discarded ? 'Tab is suspended' : 'Suspend tab';
      setPanel(null); $('tabContext').hidden = false; setOverlay(true);
    });
    host.append(el);
  }
  $('tabCount').textContent = `${data.tabs.length} ${data.tabs.length === 1 ? 'tab' : 'tabs'}`;
  const tab = current();
  $('aboutPrivacy').textContent = `${data.activeProfile?.name || 'Local profile'} · ${tab?.privateMode ? 'Current tab is private and excluded from history and session restore.' : 'Current tab is standard browsing.'}`;
  $('privateIndicator').hidden = !tab?.privateMode;
  $('zoomLevel').textContent = `${tab?.zoom || 100}%`;
  $('mediaToggle').hidden = !tab?.hasMedia;
  if (tab && !address.matches(':focus')) address.value = tab.url || '';
  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;
  $('reload').innerHTML = tab?.loading ? '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' : icons.reload;
  $('reload').title = tab?.loading ? 'Stop loading' : 'Reload';
  $('secure').classList.toggle('insecure', !!tab?.url && !tab.url.startsWith('https:'));
  const saved = data.bookmarks.some(item => item.url === tab?.url);
  $('bookmark').classList.toggle('saved', saved);
  $('bookmark').title = saved ? 'Remove from favorites' : 'Save this page · Ctrl+D';
}
function paintRecentlyClosed() {
  const host = $('recentClosedList'); host.replaceChildren();
  data.recentlyClosed.slice(0, 5).forEach((item, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.closedIndex = index;
    button.textContent = item.title || item.url; button.title = item.url; host.append(button);
  });
}
function paintProfiles() {
  const host = $('profileList'); host.replaceChildren();
  for (const profile of data.profiles) {
    const row = document.createElement('div'); row.className = 'profile-choice';
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'profile-choice-main';
    choose.setAttribute('aria-current', String(profile.id === data.activeProfileId)); choose.disabled = profile.id === data.activeProfileId;
    const avatar = document.createElement('span'); avatar.className = 'profile-choice-avatar'; avatar.textContent = profile.avatar || profile.name[0]; avatar.style.background = `${profile.accent}22`; avatar.style.color = profile.accent;
    const name = document.createElement('span'); name.textContent = profile.name; choose.append(avatar, name);
    choose.onclick = async () => { setPanel(null); await window.northstar.command('switch-profile', profile.id); };
    row.append(choose);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'profile-choice-remove'; remove.textContent = '×'; remove.title = `Remove ${profile.name}`; remove.setAttribute('aria-label', `Remove ${profile.name}`); remove.disabled = profile.id === 'default' || profile.id === data.activeProfileId;
    remove.onclick = async () => {
      if (!confirm(`Remove the “${profile.name}” profile and erase its local browsing data?`)) return;
      const result = await window.northstar.command('delete-profile', profile.id);
      if (result?.ok) { data.profiles = data.profiles.filter(item => item.id !== profile.id); paintProfiles(); showToast('Profile removed'); }
    };
    row.append(remove); host.append(row);
  }
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add-profile-button'; add.textContent = '+ Add profile';
  add.onclick = () => { $('profileList').hidden = true; setPanel(null); $('newProfileName').value = ''; $('profileDialog').showModal(); setOverlay(true); $('newProfileName').focus(); };
  host.append(add);
}
function paintBookmarks() {
  const host = $('bookmarkItems'); host.replaceChildren();
  for (const item of data.bookmarks) {
    const button = document.createElement('button'); button.className = 'bookmark-item'; button.title = item.url;
    const icon = document.createElement('span'); icon.className = 'favicon'; icon.textContent = (item.title || '★').trim().charAt(0).toUpperCase();
    const label = document.createElement('span'); label.textContent = item.title || item.url;
    button.append(icon, label); button.onclick = () => window.northstar.command('navigate', item.url);
    button.addEventListener('contextmenu', event => {
      event.preventDefault(); data.contextBookmarkUrl = item.url;
      $('bookmarkContext').style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 185))}px`;
      $('bookmarkContext').style.top = `${Math.min(event.clientY, window.innerHeight - 90)}px`;
      $('bookmarkContext').hidden = false; setOverlay(true);
    });
    host.append(button);
  }
}
function toggleBookmark() {
  const tab = current(); if (!tab?.url) return;
  const index = data.bookmarks.findIndex(item => item.url === tab.url);
  if (index >= 0) { data.bookmarks.splice(index, 1); showToast('Removed from favorites'); }
  else { data.bookmarks.unshift({ url: tab.url, title: tab.title || new URL(tab.url).hostname }); showToast('Saved to favorites'); }
  persist(); paintBookmarks(); paintTabs();
}
function navigate() {
  const value = address.value.trim();
  if (value) { setPanel(null); window.northstar.command('navigate', value); address.blur(); }
}
function timeLabel(timestamp) {
  const date = new Date(timestamp); const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function renderHistory() {
  const host = $('historyList'); host.replaceChildren();
  const query = $('historySearch').value.trim().toLowerCase();
  const filtered = data.history.filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query)).slice(0, 100);
  if (!filtered.length) {
    const empty = document.createElement('div'); empty.className = 'history-empty';
    empty.textContent = data.history.length ? 'No pages match that search.' : 'Pages you visit will appear here, ready when you need them.';
    host.append(empty); return;
  }
  let day = '';
  for (const item of filtered) {
    const label = timeLabel(item.time);
    if (label !== day) {
      day = label;
      const heading = document.createElement('div'); heading.className = 'history-day';
      const title = document.createElement('span'); title.textContent = day;
      const removeDay = document.createElement('button'); removeDay.className = 'history-remove-day'; removeDay.textContent = 'Clear day'; removeDay.onclick = () => { const date = new Date(item.time).toDateString(); data.history = data.history.filter(entry => new Date(entry.time).toDateString() !== date); persist(); renderHistory(); showToast('That day was cleared'); };
      heading.append(title, removeDay); host.append(heading);
    }
    const row = document.createElement('div'); row.className = 'history-entry'; row.tabIndex = 0; row.setAttribute('role', 'button');
    const favicon = document.createElement('span'); favicon.className = 'favicon'; favicon.textContent = (item.title || 'N').trim().charAt(0).toUpperCase();
    const copy = document.createElement('span'); copy.className = 'history-copy';
    const title = document.createElement('strong'); title.textContent = item.title || item.url;
    const url = document.createElement('span'); url.textContent = item.url;
    copy.append(title, url);
    const open = document.createElement('button'); open.className = 'history-open'; open.textContent = '↗'; open.title = 'Open this page';
    const remove = document.createElement('button'); remove.className = 'history-remove'; remove.textContent = '×'; remove.title = 'Remove from history'; remove.setAttribute('aria-label', 'Remove this visit');
    remove.onclick = event => { event.stopPropagation(); data.history = data.history.filter(entry => entry !== item); persist(); renderHistory(); showToast('Visit removed'); };
    row.append(favicon, copy, open, remove);
    const openPage = () => { setPanel(null); window.northstar.command('navigate', item.url); };
    open.onclick = openPage;
    row.onclick = event => { if (!event.target.closest('button')) openPage(); };
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') openPage(); };
    host.append(row);
  }
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const power = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}
function renderDownloads() {
  const host = $('downloadList'); host.replaceChildren();
  const activeCount = data.downloads.filter(item => !item.state || item.state === 'progressing').length;
  $('downloadBadge').hidden = activeCount === 0; $('downloadBadge').textContent = activeCount || '';
  if (!data.downloads.length) { const empty = document.createElement('div'); empty.className = 'history-empty'; empty.textContent = 'Files you save will appear here.'; host.append(empty); return; }
  for (const item of data.downloads) {
    const row = document.createElement('div'); row.className = 'download-entry';
    const active = !item.state || item.state === 'progressing'; const paused = item.paused || item.state === 'interrupted';
    const icon = document.createElement('span'); icon.className = `download-file-icon${item.state === 'completed' ? ' complete' : ''}`; icon.textContent = item.state === 'completed' ? '✓' : '↓';
    const copy = document.createElement('div'); copy.className = 'download-copy';
    const name = document.createElement('strong'); name.textContent = item.filename;
    const status = document.createElement('span');
    status.textContent = item.state === 'completed' ? `Done · ${formatBytes(item.total || item.received)}` : active ? `${formatBytes(item.received)} of ${formatBytes(item.total)}${item.remaining ? ` · ${Math.ceil(item.remaining / 1000)}s left` : ''}` : item.state;
    copy.append(name, status);
    if (active || paused) { const track = document.createElement('div'); track.className = 'download-track'; const fill = document.createElement('i'); fill.style.width = `${item.total ? Math.min(100, item.received / item.total * 100) : 8}%`; track.append(fill); copy.append(track); }
    const actions = document.createElement('div'); actions.className = 'download-actions';
    if (active || paused) {
      const toggle = document.createElement('button'); toggle.textContent = paused ? 'Resume' : 'Pause'; toggle.onclick = () => window.northstar.command(paused ? 'download-resume' : 'download-pause', item.id); actions.append(toggle);
      const cancel = document.createElement('button'); cancel.textContent = '×'; cancel.title = 'Cancel download'; cancel.onclick = () => window.northstar.command('download-cancel', item.id); actions.append(cancel);
    } else if (item.state === 'completed') {
      const open = document.createElement('button'); open.textContent = 'Open'; open.onclick = () => window.northstar.command('download-open', item.id); actions.append(open);
      const reveal = document.createElement('button'); reveal.textContent = 'Show'; reveal.title = 'Show in folder'; reveal.onclick = () => window.northstar.command('download-reveal', item.id); actions.append(reveal);
    }
    row.append(icon, copy, actions); host.append(row);
  }
}
address.addEventListener('keydown', event => { if (event.key === 'Enter') navigate(); if (event.key === 'Escape') { address.blur(); paintTabs(); } });
address.addEventListener('focus', () => address.select());
$('back').onclick = () => window.northstar.command('back');
$('forward').onclick = () => window.northstar.command('forward');
$('reload').onclick = () => window.northstar.command(current()?.loading ? 'stop' : 'reload');
$('newTab').onclick = () => window.northstar.command('new-tab');
$('bookmark').onclick = toggleBookmark;
$('addFavorite').onclick = toggleBookmark;
$('menu').onclick = () => setPanel($('menuPanel').hidden ? 'menu' : null);
$('profile').onclick = () => setPanel($('menuPanel').hidden ? 'menu' : null);
$('downloads').onclick = () => setPanel($('downloadsPanel').hidden ? 'downloads' : null);
$('mediaToggle').onclick = () => window.northstar.command('media-toggle');
$('menuPanel').addEventListener('click', event => {
  const closedIndex = event.target.closest('[data-closed-index]')?.dataset.closedIndex;
  if (closedIndex !== undefined) { setPanel(null); window.northstar.command('restore-closed', Number(closedIndex)); return; }
  const action = event.target.closest('[data-page-action]')?.dataset.pageAction;
  if (!action) return;
  setPanel(null);
  if (action === 'home') window.northstar.command('home');
  if (action === 'find') openFind();
  if (action === 'print') window.northstar.command('print');
  if (action === 'save-page') window.northstar.command('save-page');
});
$('menuPanel').addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'toggle-profiles') { $('profileList').hidden = !$('profileList').hidden; if (!$('profileList').hidden) paintProfiles(); return; }
  if (action === 'history') setPanel('history');
  if (action === 'downloads') setPanel('downloads');
  if (action === 'settings') setPanel('settings');
  if (action === 'restore-closed') { setPanel(null); window.northstar.command('restore-closed'); }
  if (action === 'private-tab') { setPanel(null); window.northstar.command('new-private-tab'); }
  if (action === 'sort-bookmarks') { data.bookmarks.sort((a, b) => (a.title || '').localeCompare(b.title || '')); persist(); paintBookmarks(); setPanel(null); showToast('Favorites sorted A–Z'); }
  if (action === 'import-bookmarks') { setPanel(null); $('bookmarkImport').click(); }
  if (action === 'export-bookmarks') {
    setPanel(null);
    const blob = new Blob([JSON.stringify({ version: 1, bookmarks: data.bookmarks }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); const objectUrl = URL.createObjectURL(blob); link.href = objectUrl; link.download = 'northstar-favorites.json'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Favorites export started');
  }
  if (action === 'export-bookmarks-html') {
    setPanel(null);
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const rows = data.bookmarks.map(item => `<DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</A>`).join('\n');
    downloadText('northstar-favorites.html', `<!DOCTYPE NETSCAPE-Bookmark-file-1><META CHARSET="UTF-8"><TITLE>Northstar Favorites</TITLE><H1>Favorites</H1><DL><p>${rows}</DL>`, 'text/html');
  }
  if (action === 'export-history') { setPanel(null); downloadText('northstar-history.json', JSON.stringify(data.history, null, 2), 'application/json'); }
  if (action === 'export-settings') { setPanel(null); downloadText('northstar-settings.json', JSON.stringify(data.preferences, null, 2), 'application/json'); }
  if (action === 'import-settings') { setPanel(null); $('settingsImport').click(); }
});
function downloadText(filename, text, type) {
  const link = document.createElement('a'); const objectUrl = URL.createObjectURL(new Blob([text], { type }));
  link.href = objectUrl; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); showToast(`Saving ${filename}`);
}
$('closeDownloads').onclick = () => setPanel(null);
$('openDownloadsFolder').onclick = () => window.northstar.command('open-downloads');
$('clearDownloads').onclick = () => { data.downloads = data.downloads.filter(item => !item.state || item.state === 'progressing' || item.paused); renderDownloads(); showToast('Finished downloads cleared'); };
$('bookmarkContext').addEventListener('click', event => {
  const action = event.target.closest('[data-bookmark-action]')?.dataset.bookmarkAction;
  const index = data.bookmarks.findIndex(item => item.url === data.contextBookmarkUrl);
  if (index < 0 || !action) return;
  setPanel(null);
  if (action === 'remove') { data.bookmarks.splice(index, 1); persist(); paintBookmarks(); paintTabs(); showToast('Favorite removed'); return; }
  $('favoriteTitle').value = data.bookmarks[index].title || '';
  $('favoriteUrl').value = data.bookmarks[index].url;
  data.editingBookmarkIndex = index;
  $('bookmarkDialog').showModal(); setOverlay(true);
});
$('bookmarkForm').addEventListener('submit', event => {
  event.preventDefault();
  const index = data.editingBookmarkIndex;
  let parsed;
  try { parsed = new URL($('favoriteUrl').value.trim()); } catch { return; }
  if (!['http:', 'https:'].includes(parsed.protocol) || index == null || !data.bookmarks[index]) return;
  data.bookmarks[index] = { title: $('favoriteTitle').value.trim(), url: parsed.href };
  persist(); paintBookmarks(); paintTabs(); $('bookmarkDialog').close(); showToast('Favorite updated');
});
$('cancelFavorite').onclick = () => $('bookmarkDialog').close();
$('bookmarkDialog').addEventListener('close', () => setOverlay(false));
$('cancelProfile').onclick = () => $('profileDialog').close();
$('profileDialog').addEventListener('close', () => setOverlay(false));
$('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await window.northstar.command('create-profile', { name: $('newProfileName').value, avatar: $('newProfileAvatar').value });
  if (!result?.ok) { showToast(result?.error || 'Could not create profile'); return; }
  $('profileDialog').close();
  await window.northstar.command('switch-profile', result.profile.id);
});
$('bookmarkImport').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text(); let items;
    if (/\.html?$/i.test(file.name) || file.type === 'text/html') {
      const documentFile = new DOMParser().parseFromString(text, 'text/html');
      items = [...documentFile.querySelectorAll('a[href]')].map(a => ({ title: a.textContent.trim(), url: a.href }));
    } else {
      const parsed = JSON.parse(text); items = Array.isArray(parsed) ? parsed : parsed.bookmarks;
    }
    if (!Array.isArray(items)) throw new Error('This file does not contain a favorites list.');
    const preview = items.slice(0, 1000).filter(item => { try { const u = new URL(item.url); return ['http:', 'https:'].includes(u.protocol) && !data.bookmarks.some(existing => existing.url === u.href); } catch { return false; } }).length;
    if (!confirm(`Found ${preview} new favorites. Import them and keep your existing favorites?`)) return;
    const existing = new Set(data.bookmarks.map(item => item.url)); let added = 0;
    for (const item of items.slice(0, 1000)) {
      try { const url = new URL(item.url); if (!['http:', 'https:'].includes(url.protocol) || existing.has(url.href)) continue; data.bookmarks.push({ title: String(item.title || url.hostname).slice(0, 80), url: url.href }); existing.add(url.href); added++; } catch {}
    }
    persist(); paintBookmarks(); showToast(`${added} favorite${added === 1 ? '' : 's'} imported`);
  } catch { showToast('Could not read that favorites file'); }
  event.target.value = '';
});
$('settingsImport').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid settings');
    const candidate = { ...data.preferences };
    if (['system', 'light', 'dark'].includes(imported.theme)) candidate.theme = imported.theme;
    if (['google', 'bing', 'duckduckgo', 'brave'].includes(imported.searchEngine)) candidate.searchEngine = imported.searchEngine;
    if (['comfortable', 'compact'].includes(imported.density)) candidate.density = imported.density;
    if (typeof imported.doNotTrack === 'boolean') candidate.doNotTrack = imported.doNotTrack;
    if (typeof imported.restoreSession === 'boolean') candidate.restoreSession = imported.restoreSession;
    if ([90, 100, 110].includes(Number(imported.textScale))) candidate.textScale = Number(imported.textScale);
    if (typeof imported.homePageUrl === 'string' && (!imported.homePageUrl || /^https?:\/\//i.test(imported.homePageUrl))) candidate.homePageUrl = imported.homePageUrl;
    if (typeof imported.profileName === 'string') candidate.profileName = imported.profileName.slice(0, 24);
    if (['A', '✦', '☀', '🌙', '🧭'].includes(imported.profileAvatar)) candidate.profileAvatar = imported.profileAvatar;
    if (/^#[0-9a-f]{6}$/i.test(imported.profileAccent || '')) candidate.profileAccent = imported.profileAccent;
    if (JSON.stringify(candidate) === JSON.stringify(data.preferences)) throw new Error('No supported preferences found');
    if (confirm('Settings file is valid. Replace your current preferences with these settings?')) { data.preferences = candidate; applyPreferences(); showToast('Settings imported'); }
  } catch { showToast('Could not import settings from that file'); }
  event.target.value = '';
});
$('tabContext').addEventListener('click', event => {
  const action = event.target.closest('[data-tab-action]')?.dataset.tabAction;
  if (!action || data.contextTabId === null) return;
  setPanel(null);
  const commands = { duplicate: 'duplicate', pin: 'pin', mute: 'mute', pip: 'picture-in-picture', discard: 'discard-tab', close: 'close', 'close-others': 'close-others' };
  window.northstar.command(commands[action], data.contextTabId);
});
$('closeHistory').onclick = () => setPanel(null);
$('closeSettings').onclick = () => setPanel(null);
$('themeChoices').addEventListener('click', event => {
  const theme = event.target.closest('[data-theme-choice]')?.dataset.themeChoice;
  if (theme) { data.preferences.theme = theme; applyPreferences(); }
});
$('dntToggle').addEventListener('change', () => { data.preferences.doNotTrack = $('dntToggle').checked; applyPreferences(); showToast(data.preferences.doNotTrack ? 'Do Not Track is on' : 'Do Not Track is off'); });
$('restoreSessionToggle').addEventListener('change', () => { data.preferences.restoreSession = $('restoreSessionToggle').checked; applyPreferences(); showToast(data.preferences.restoreSession ? 'Previous tabs will be restored' : 'Northstar will start fresh'); });
$('saveHomePage').onclick = () => {
  const raw = $('homePageInput').value.trim();
  if (!raw) data.preferences.homePageUrl = '';
  else { try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); data.preferences.homePageUrl = url.href; } catch { showToast('Enter a valid http or https address'); return; } }
  applyPreferences(); showToast(data.preferences.homePageUrl ? 'Home page saved' : 'Northstar start page restored');
};
function saveProfile() { data.preferences.profileName = $('profileNameInput').value.trim() || 'Andrew'; data.preferences.profileAvatar = $('profileAvatarInput').value; data.preferences.profileAccent = $('profileAccentInput').value; applyPreferences(); }
$('profileNameInput').addEventListener('change', saveProfile); $('profileAvatarInput').addEventListener('change', saveProfile); $('profileAccentInput').addEventListener('input', saveProfile);
$('resetProfile').onclick = () => { data.preferences.profileName = 'Andrew'; data.preferences.profileAvatar = 'A'; data.preferences.profileAccent = '#596fe9'; applyPreferences(); showToast('Profile appearance reset'); };
$('clearSiteCookies').onclick = () => window.northstar.command('clear-site-cookies');
$('clearCache').onclick = () => window.northstar.command('clear-cache');
$('showSitePermissions').onclick = async () => {
  const state = await window.northstar.command('site-permissions');
  const entries = Object.entries(state?.permissions || {});
  $('permissionSummary').textContent = state?.origin ? (entries.length ? `${state.origin}: ${entries.map(([key, allowed]) => `${key.replace('-', ' ')} ${allowed ? 'allowed' : 'blocked'}`).join(', ')}` : `${state.origin}: no saved choices`) : 'Permissions are available for websites only.';
};
$('revokeSitePermissions').onclick = async () => {
  const state = await window.northstar.command('revoke-site-permissions');
  $('permissionSummary').textContent = state?.origin ? `${state.origin}: no saved choices` : 'No site is open.';
};
$('resetBrowserData').onclick = async () => {
  if (!confirm('Clear favorites, history, cookies, cached data, site permissions, and preferences? Current tabs will stay open.')) return;
  const profile = data.activeProfile || { name: 'Andrew', avatar: 'A', accent: '#596fe9' };
  data.bookmarks = []; data.history = []; data.preferences = { theme: 'system', searchEngine: 'google', doNotTrack: false, density: 'comfortable', restoreSession: false, homePageUrl: '', profileName: profile.name, profileAvatar: profile.avatar, profileAccent: profile.accent };
  persist(); paintBookmarks(); renderHistory(); applyPreferences(); await window.northstar.command('reset-browser-data'); showToast('Browser data cleared');
};
$('openDiagnosticLog').onclick = () => window.northstar.command('open-diagnostics');
$('refreshMemory').onclick = async () => { const usage = await window.northstar.command('memory-usage'); $('memoryUsage').textContent = `Browser UI process: ${usage.workingSetMiB} MiB working set · ${usage.privateMiB} MiB private memory`; };
$('copyDiagnostics').onclick = () => window.northstar.command('copy-diagnostics');
$('restartSafeMode').onclick = () => { if (confirm('Restart Northstar without restoring the saved session?')) window.northstar.command('restart-safe-mode'); };
$('engineChoices').addEventListener('click', event => {
  const engine = event.target.closest('[data-engine]')?.dataset.engine;
  if (engine) { data.preferences.searchEngine = engine; applyPreferences(); }
});
$('settingsPanel').addEventListener('click', event => {
  const density = event.target.closest('[data-density]')?.dataset.density;
  if (density) { data.preferences.density = density; applyPreferences(); }
  const textScale = event.target.closest('[data-text-scale]')?.dataset.textScale;
  if (textScale) { data.preferences.textScale = Number(textScale); applyPreferences(); }
});
$('historySearch').addEventListener('input', renderHistory);
$('clearHistory').onclick = () => { data.history = []; persist(); renderHistory(); showToast('Browsing history cleared'); };
function changeZoom(delta) {
  data.zoom = Math.max(50, Math.min(200, (current()?.zoom || data.zoom) + delta));
  $('zoomLevel').textContent = `${data.zoom}%`;
  window.northstar.command('zoom', data.zoom / 100);
}
$('zoomOut').onclick = () => changeZoom(-10);
$('zoomIn').onclick = () => changeZoom(10);
$('zoomLevel').onclick = () => { data.zoom = 100; $('zoomLevel').textContent = '100%'; window.northstar.command('zoom', 1); };
function openFind() { setPanel('find'); $('findInput').focus(); $('findInput').select(); }
function searchInPage(forward = true) { const text = $('findInput').value; window.northstar.command('find', { text, options: { forward, findNext: true } }); }
$('findInput').addEventListener('input', () => { const text = $('findInput').value; if (text) window.northstar.command('find', { text, options: { forward: true } }); else window.northstar.command('find'); });
$('findInput').addEventListener('keydown', event => { if (event.key === 'Enter') searchInPage(!event.shiftKey); if (event.key === 'Escape') { window.northstar.command('find'); setPanel(null); } });
$('findNext').onclick = () => searchInPage(true);
$('findPrevious').onclick = () => searchInPage(false);
$('findClose').onclick = () => { window.northstar.command('find'); setPanel(null); };
window.northstar.on('find:open', openFind);
window.northstar.on('find:result', result => { $('findCount').textContent = result.matches ? `${result.activeMatchOrdinal} of ${result.matches}` : 'No matches'; });
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#menuPanel, #historyPanel, #settingsPanel, #downloadsPanel, #findBar, #tabContext, #bookmarkContext, #bookmarkDialog, #profileDialog, #menu, #profile')) setPanel(null);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') setPanel(null); });
window.northstar.on('tabs:changed', state => { data.tabs = state.tabs; data.activeId = state.activeId; data.recentlyClosed = state.recentlyClosed || data.recentlyClosed; paintTabs(); paintRecentlyClosed(); });
window.northstar.on('tab:active', tab => { address.value = tab.url || ''; data.zoom = tab.zoom || 100; $('zoomLevel').textContent = `${data.zoom}%`; paintTabs(); });
window.northstar.on('omnibox:focus', () => { address.focus(); address.select(); });
window.northstar.on('bookmark:toggle', toggleBookmark);
window.northstar.on('history:open', () => setPanel('history'));
window.northstar.on('media:toggle', () => window.northstar.command('media-toggle'));
window.northstar.on('downloads:open', () => setPanel('downloads'));
window.northstar.on('home:open', () => window.northstar.command('home'));
window.northstar.on('history:add', entry => {
  if (!entry.url || entry.url === 'about:blank') return;
  data.history.unshift({ ...entry, time: Date.now() }); data.history = data.history.slice(0, 500); persist();
  if (!$('historyPanel').hidden) renderHistory();
});
window.northstar.on('toast', showToast);
window.northstar.on('tab:crashed', () => { showToast('This page stopped responding'); $('toastAction').hidden = false; });
$('toastAction').onclick = () => { window.northstar.command('reload'); $('toast').classList.remove('show'); };
window.northstar.on('download:started', item => { data.downloads.unshift({ ...item, received: 0, state: 'progressing' }); renderDownloads(); showToast(`Downloading ${item.filename}`); });
window.northstar.on('download:progress', update => { const item = data.downloads.find(entry => entry.id === update.id); if (item) Object.assign(item, update); renderDownloads(); });
window.northstar.on('download:done', result => { const item = data.downloads.find(entry => entry.id === result.id); if (item) Object.assign(item, result); renderDownloads(); showToast(result.state === 'completed' ? `Saved ${result.filename}` : `Download ${result.state}`); });
window.northstar.on('profiles:changed', state => { data.profiles = state.profiles; data.activeProfileId = state.activeProfileId; data.activeProfile = data.profiles.find(item => item.id === data.activeProfileId) || data.activeProfile; paintProfiles(); });
window.northstar.state().then(state => {
  data.tabs = state.tabs; data.activeId = state.activeId; data.recentlyClosed = state.recentlyClosed || [];
  data.profiles = state.profiles || []; data.activeProfileId = state.activeProfileId; data.activeProfile = state.activeProfile;
  if (firstRunForProfile && data.activeProfile) {
    data.preferences.profileName = data.activeProfile.name; data.preferences.profileAvatar = data.activeProfile.avatar; data.preferences.profileAccent = data.activeProfile.accent;
    applyPreferences();
  }
  $('aboutDetails').textContent = `Northstar ${state.version} · Electron ${state.electron} · Chromium ${state.chromium} · ${state.improvements} improvements${state.safeMode ? ' · Safe mode' : ''}`;
  $('aboutPrivacy').textContent = `Current profile: ${state.activeProfile?.name || 'Local profile'} · Profile data stays on this device.`;
  $('profileList').hidden = true;
  paintTabs(); paintBookmarks(); paintRecentlyClosed(); paintProfiles();
});
if (!firstRunForProfile) applyPreferences();
