'use strict';

const storageKey = 'tabMoa';
const draftKey = 'tabMoa.editorDraft';
const editorParams = new URLSearchParams(location.search);
const detachedEditor = editorParams.get('editor') === '1';
const sourceWindowId = editorParams.has('sourceWindow') ? Number(editorParams.get('sourceWindow')) : null;
const icons = {
  layers: '<rect x="3" y="7" width="14" height="13" rx="2.5"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2M3 11h14"/>',
  tag: '<path d="M20 13.2 13.2 20a2 2 0 0 1-2.8 0L4 13.6V4h9.6l6.4 6.4a2 2 0 0 1 0 2.8Z"/><path d="M8.5 8.5h.01" stroke-width="3"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9L12 3Z"/>',
  link: '<path d="M10 13.8a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7l-2 2M14 10.2a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7l2-2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  up: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  down: '<path d="M12 5v14m-5-5 5 5 5-5"/>',
  more: '<path d="M5 12h.01m7 0h.01m7 0h.01" stroke-width="3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-.7 13H6.7L6 7m4 4v5m4-5v5"/>',
  external: '<path d="M13 5h6v6m0-6-8 8m7 1v5H5V6h5"/>',
};
const emojiOptions = ['📁', '💻', '📚', '🎨', '🎧', '🎮', '🏠', '🧳', '🛒', '☕', '🔖', '💡', '🌿', '🚀', '✨'];
const chromeColors = {
  grey: '#9aa0a6', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa903e',
};
const main = document.querySelector('#main-view');
const switcher = document.querySelector('#view-switcher');
const dialog = document.querySelector('#editor-dialog');
const editor = document.querySelector('#editor-content');
const addButton = document.querySelector('#add-button');
const status = document.querySelector('#status-message');

if (detachedEditor) {
  document.body.dataset.editorWindow = '';
  document.title = '탭 모아 편집';
}

let data = { groups: [], tags: [], stars: [] };
let view = 'default';
let activeTagId = null;
let menuId = null;
let draft = null;
let dialogTrigger = null;
let busy = false;
let opening = false;
let statusTimer;
const expanded = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function iconButton(action, glyph, label, attributes = '', extraClass = '') {
  return `<button type="button" class="icon-button ${extraClass}" data-action="${action}" aria-label="${label}" title="${label}" ${attributes}>${icon(glyph)}</button>`;
}

function color(value) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#b66d63';
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || /^[/?#]/.test(trimmed)) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const bareHostWithPort = /^(?:localhost|[^/:]+\.[^/:]+):\d+(?:[/?#]|$)/i.test(trimmed);
  try {
    const url = new URL(hasScheme && !bareHostWithPort ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function domain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function pageAddress(value) {
  const url = new URL(value);
  return `${url.host.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
}

function pageLabel(page) {
  return page.alias || page.title || domain(page.url);
}

function readData(result) {
  const saved = result[storageKey];
  return { groups: saved?.groups ?? [], tags: saved?.tags ?? [], stars: saved?.stars ?? [] };
}

async function updateData(update) {
  const commit = async () => {
    const next = readData(await chrome.storage.local.get(storageKey));
    update(next);
    await chrome.storage.local.set({ [storageKey]: next });
    data = next;
  };

  if (navigator.locks) await navigator.locks.request(storageKey, commit);
  else await commit();
}

function announce(message) {
  status.textContent = message;
  status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.hidden = true; }, 3200);
}

function emptyState(glyph, title, text) {
  return `<div class="empty-state"><span class="empty-icon">${icon(glyph)}</span><h2>${title}</h2><p>${text}</p></div>`;
}

function pageButton(page) {
  return `<button type="button" class="page-button" data-action="open-page" data-url="${escapeHtml(page.url)}" title="${escapeHtml(page.url)}">
    <span class="page-icon">${icon('link')}</span><span class="page-copy"><span class="page-name">${escapeHtml(pageLabel(page))}</span>
    <span class="page-url">${escapeHtml(pageAddress(page.url))}</span></span><span class="page-external">${icon('external')}</span>
  </button>`;
}

function groupList(groups) {
  if (!groups.length) {
    return activeTagId ? emptyState('layers', '이 태그에 속한 그룹이 없어요', '그룹을 수정해 이 태그를 추가할 수 있어요.')
      : emptyState('layers', '저장한 탭 그룹이 없어요', '아래 + 버튼으로 함께 열 페이지를 묶어 보세요.');
  }

  return `<div class="item-list">${groups.map((group) => {
    const groupId = escapeHtml(group.id);
    const isExpanded = expanded.has(group.id);
    const menuOpen = menuId === group.id;
    return `<article class="group-card" data-group-id="${groupId}">
      <div class="group-row"><button type="button" class="group-open" data-action="open-group" title="${escapeHtml(group.name)}">
        <span class="group-icon" aria-hidden="true">${renderSavedIcon(group.icon)}</span><span class="group-name">${escapeHtml(group.name)}</span>
      </button>
      ${iconButton('expand-group', 'chevron', isExpanded ? '링크 접기' : '링크 더 보기', `aria-expanded="${isExpanded}"`, 'expand-button')}
      ${iconButton('show-group-menu', 'more', '그룹 메뉴', `aria-expanded="${menuOpen}"`, 'more-button')}
      </div>
      ${menuOpen ? `<div class="context-menu"><button type="button" data-action="edit-group">${icon('edit')}그룹 수정</button><button type="button" class="danger-button" data-action="delete-group">${icon('trash')}그룹 삭제</button></div>` : ''}
      ${isExpanded ? `<div class="group-links">${group.links.map(pageButton).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function render() {
  const selectedTag = view === 'tags' ? data.tags.find((tag) => tag.id === activeTagId) : undefined;
  if (!selectedTag) activeTagId = null;
  document.body.dataset.theme = selectedTag ? 'tag' : view;
  document.body.style.setProperty('--tag-color', selectedTag ? color(selectedTag.color) : '');
  switcher.dataset.active = view;
  switcher.querySelectorAll('[data-view]').forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.classList.toggle('is-active', selected);
  });
  main.setAttribute('aria-labelledby', `tab-${view}`);

  if (view === 'starred') {
    main.innerHTML = `<div class="section-heading"><h1>즐겨찾기</h1></div>${data.stars.length
      ? `<div class="starred-list">${data.stars.map((star) => `<div class="starred-row">${pageButton(star)}
        ${iconButton('remove-star', 'star', '즐겨찾기 해제', `data-url="${escapeHtml(star.url)}"`, 'star-toggle is-starred')}</div>`).join('')}</div>`
      : emptyState('star', '즐겨찾기가 비어 있어요', '그룹의 링크에 별을 달거나 + 버튼으로 페이지를 추가하세요.')}`;
    return;
  }

  if (selectedTag) {
    main.innerHTML = `<div class="section-heading">${iconButton('back-to-tags', 'left', '태그 목록으로')}
      ${selectedTag.icon ? `<span class="tag-heading-icon" aria-hidden="true">${renderSavedIcon(selectedTag.icon)}</span>` : ''}<h1>${escapeHtml(selectedTag.name)}</h1></div>
      ${groupList(data.groups.filter((group) => group.tagIds.includes(selectedTag.id)))}`;
    return;
  }

  if (view === 'tags') {
    main.innerHTML = `<div class="section-heading"><h1>태그</h1></div>${data.tags.length
      ? `<div class="tag-grid">${data.tags.map((tag) => `<button type="button" class="tag-card" data-action="open-tag" data-tag-id="${escapeHtml(tag.id)}" style="--tile-color: ${color(tag.color)}" title="${escapeHtml(tag.name)}">
        <span class="tag-icon" aria-hidden="true">${tag.icon ? renderSavedIcon(tag.icon) : icon('tag')}</span><span class="tag-name">${escapeHtml(tag.name)}</span>
      </button>`).join('')}</div>`
      : emptyState('tag', '만든 태그가 없어요', '그룹을 추가하거나 수정할 때 태그를 만들 수 있어요.')}`;
    return;
  }

  main.innerHTML = `<div class="section-heading"><h1>탭 그룹</h1></div>${groupList(data.groups)}`;
}

function positionGroupMenu() {
  const menu = main.querySelector('.context-menu');
  if (!menu) return;
  const listBounds = main.getBoundingClientRect();
  if (menu.getBoundingClientRect().bottom <= listBounds.bottom) return;
  menu.classList.add('opens-up');
  if (menu.getBoundingClientRect().top < listBounds.top) {
    menu.classList.remove('opens-up');
    menu.scrollIntoView({ block: 'nearest' });
  }
}

function setView(nextView) {
  view = nextView;
  activeTagId = null;
  menuId = null;
  main.scrollTop = 0;
  render();
}

function renderSavedIcon(value) {
  return isPngIcon(value) ? `<img class="uploaded-icon" src="${value}" alt="">` : escapeHtml(value);
}

function selectIcon(name, value) {
  const uploaded = isPngIcon(value) ? '<option value="uploaded" selected disabled>PNG 이미지</option>' : '';
  return `<select name="${name}">${uploaded}<option value="">아이콘 없음</option>${emojiOptions.map((emoji) =>
    `<option value="${emoji}" ${emoji === value ? 'selected' : ''}>${emoji}</option>`).join('')}</select>`;
}

function iconUpload(name, value) {
  const isUploaded = isPngIcon(value);
  const buttonLabel = isUploaded ? 'PNG 바꾸기' : 'PNG 첨부';
  const label = name === 'tag-icon' ? '태그 아이콘' : '그룹 아이콘';
  return `<div class="icon-upload" data-icon-control="${name}">
    <span class="icon-upload-preview" ${isUploaded ? '' : 'hidden'}>${isUploaded ? renderSavedIcon(value) : ''}</span>
    ${detachedEditor
      ? `<input type="file" name="${name}-file" data-icon-upload="${name}" accept="image/png,.png" aria-label="${label} PNG 파일" hidden>
        <button type="button" class="secondary-button" data-choose-png="${name}" aria-label="${label} ${buttonLabel}" title="${label} · 5MB 이하">${buttonLabel}</button>`
      : `<button type="button" class="secondary-button" data-action="open-editor-window" data-icon-target="${name}" aria-label="편집 창에서 ${label} ${buttonLabel}" title="편집 창에서 ${label} PNG 파일을 선택합니다">${buttonLabel} ↗</button>`}
    </div>`;
}

function clearIconPreview(input) {
  const controls = editor.querySelector(`[data-icon-control="${input.name}"]`);
  const preview = controls.querySelector('.icon-upload-preview');
  if (preview.hidden) return;
  preview.replaceChildren();
  preview.hidden = true;
  input.querySelector('option[value="uploaded"]')?.remove();
  const button = controls.querySelector('button');
  button.textContent = detachedEditor ? 'PNG 첨부' : 'PNG 첨부 ↗';
  button.setAttribute('aria-label', button.getAttribute('aria-label').replace('바꾸기', '첨부'));
}

function makeGroupDraft(group) {
  return {
    id: group?.id ?? null,
    name: group?.name ?? '',
    icon: group?.icon ?? '',
    links: group ? structuredClone(group.links) : [],
    tagIds: new Set(group?.tagIds ?? []),
    newTags: [],
    starChanges: new Map(),
    linkUrl: '',
    tag: { visible: false, name: '', color: '#d88c81', icon: '' },
  };
}

function makeDraft(group = null, mode = 'group') {
  return { id: crypto.randomUUID(), mode, group: makeGroupDraft(group), star: { url: '', alias: '', title: '' }, groupToDelete: group };
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    if (!saved || !['group', 'star'].includes(saved.mode)) return null;
    saved.group.tagIds = new Set(saved.group.tagIds);
    saved.group.starChanges = new Map(saved.group.starChanges);
    if (saved.group.id && !data.groups.some((group) => group.id === saved.group.id)) {
      localStorage.removeItem(draftKey);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function persistDraft() {
  if (!draft || draft.mode === 'delete') return false;
  const group = { ...draft.group, tagIds: [...draft.group.tagIds], starChanges: [...draft.group.starChanges] };
  try {
    // Toolbar popup teardown can interrupt asynchronous writes when focus changes.
    localStorage.setItem(draftKey, JSON.stringify({ id: draft.id, mode: draft.mode, group, star: draft.star }));
    return true;
  } catch {
    formError('임시 저장 공간이 부족해요. 편집을 마친 뒤 저장 버튼을 눌러 주세요.');
    return false;
  }
}

function clearDraft() {
  if (loadDraft()?.id === draft.id) localStorage.removeItem(draftKey);
}

function findEditorWindow() {
  return chrome.extension.getViews().find((page) => page !== window && page.document.body?.hasAttribute('data-editor-window'));
}

async function focusEditorWindow(page) {
  const { id } = await page.chrome.windows.getCurrent();
  await chrome.windows.update(id, { focused: true });
}

async function openEditorWindow(iconTarget) {
  const existing = findEditorWindow();
  if (existing) {
    await focusEditorWindow(existing);
    return;
  }

  if (!persistDraft()) return;
  const { id } = await chrome.windows.getCurrent();
  const url = new URL(chrome.runtime.getURL('popup.html'));
  url.searchParams.set('editor', '1');
  url.searchParams.set('sourceWindow', String(id));
  if (iconTarget) url.searchParams.set('icon', iconTarget);
  await chrome.windows.create({ url: url.href, type: 'popup', width: 520, height: 690, focused: true });
  if (chrome.extension.getViews({ type: 'popup' }).includes(window)) window.close();
  else dialog.close();
}

function showEditor(trigger, entry) {
  dialogTrigger = trigger;
  draft = entry;
  renderEditor(false);
  dialog.showModal();
  const iconTarget = editorParams.get('icon');
  const chooser = iconTarget && editor.querySelector(`[data-choose-png="${CSS.escape(iconTarget)}"]`);
  if (chooser) chooser.focus();
  else focusEditor();
}

async function openEditor(trigger, group = null, mode = 'group') {
  const existing = mode !== 'delete' && findEditorWindow();
  if (existing) {
    await focusEditorWindow(existing);
    return;
  }
  const pending = mode !== 'delete' && loadDraft();
  showEditor(trigger, pending || makeDraft(group, mode));
  persistDraft();
  if (pending && group && pending.group.id !== group.id) {
    formError('작성 중인 초안을 먼저 열었어요. 저장하거나 초안을 삭제한 뒤 이 그룹을 수정할 수 있어요.');
  }
}

function focusEditor() {
  const field = { group: '[name="group-name"]', star: '[name="star-url"]', delete: '[data-action="close-editor"]' };
  editor.querySelector(field[draft.mode]).focus({ preventScroll: true });
}

function editorHeader(title) {
  const windowButton = detachedEditor || draft.mode === 'delete' ? '' :
    `<button type="button" class="secondary-button open-editor-window" data-action="open-editor-window" title="다른 탭으로 이동해도 편집 창은 열려 있습니다">${icon('external')}별도 창에서 편집</button>`;
  return `<div class="editor-head"><h2 id="editor-title">${title}</h2><div class="editor-head-actions">${windowButton}${iconButton('close-editor', 'close', '닫기')}</div></div>`;
}

function editorTabs() {
  return `<div class="pill-switch" aria-label="추가할 항목">
    <button type="button" data-action="choose-group" aria-pressed="${draft.mode === 'group'}">탭 그룹</button>
    <button type="button" data-action="choose-starred" aria-pressed="${draft.mode === 'star'}">즐겨찾기</button>
  </div>`;
}

function editorFooter(form, saveLabel) {
  return `<div class="editor-footer"><button type="button" class="button button-secondary" data-action="discard-draft">초안 삭제</button>
    <button type="submit" class="button button-primary" form="${form}">${saveLabel}</button></div>`;
}

function linkIsStarred(url) {
  return draft.group.starChanges.has(url) ? Boolean(draft.group.starChanges.get(url)) : data.stars.some((star) => star.url === url);
}

function renderEditor(keepScroll = true) {
  const scroll = keepScroll ? (editor.querySelector('.editor-body')?.scrollTop ?? 0) : 0;
  const group = draft.group;
  if (draft.mode === 'delete') {
    editor.innerHTML = `${editorHeader('탭 그룹 삭제')}<div class="editor-body"><p>‘${escapeHtml(draft.groupToDelete.name)}’ 그룹을 삭제할까요? 그룹에 있던 즐겨찾기는 계속 사용할 수 있어요.</p><p class="form-error" role="alert" hidden></p></div>
      <div class="editor-footer"><button type="button" class="button button-secondary" data-action="close-editor">취소</button>
      <button type="button" class="button button-primary danger-button" data-action="confirm-delete">삭제</button></div>`;
  } else if (draft.mode === 'star') {
    editor.innerHTML = `${editorHeader('새 항목 추가')}<form id="star-form" class="editor-body" novalidate>
      ${editorTabs()}
      <label class="field"><span>웹페이지 주소</span><input type="text" inputmode="url" name="star-url" placeholder="https://example.com" value="${escapeHtml(draft.star.url)}" required></label>
      <button class="secondary-button current-page-button" type="button" data-action="current-page">현재 페이지 가져오기</button>
      <label class="field"><span>별칭 <small>선택</small></span><input name="star-alias" maxlength="100" placeholder="목록에 표시할 이름" value="${escapeHtml(draft.star.alias)}"></label>
      <p class="form-error" role="alert" hidden></p>
    </form>${editorFooter('star-form', '즐겨찾기 저장')}`;
  } else {
    const tags = [...data.tags, ...group.newTags];
    editor.innerHTML = `${editorHeader(group.id ? '탭 그룹 수정' : '새 항목 추가')}
    <form id="group-form" class="editor-body" novalidate>
      ${group.id ? '' : editorTabs()}
      <div class="icon-fields"><div class="field-row"><label class="field"><span>그룹 이름</span><input name="group-name" maxlength="60" placeholder="예: 작업에 필요한 탭" required value="${escapeHtml(group.name)}"></label>
      <label class="field"><span>아이콘 <small>선택</small></span>${selectIcon('group-icon', group.icon)}</label></div>${iconUpload('group-icon', group.icon)}</div>
      <div class="field link-entry"><label for="link-url">웹페이지</label><div class="input-action"><input id="link-url" name="link-url" type="text" inputmode="url" placeholder="https://example.com" value="${escapeHtml(group.linkUrl)}">
      <button type="button" class="secondary-button" data-action="add-link">추가</button></div>
      <button class="secondary-button current-page-button" type="button" data-action="current-page">현재 페이지 추가</button></div>
      ${group.links.length ? `<div class="link-list" aria-label="그룹의 웹페이지">${group.links.map((link, index) => {
        const starred = linkIsStarred(link.url);
        return `<div class="link-row" data-link-id="${escapeHtml(link.id)}"><div class="link-fields">
          <input type="text" data-link-alias aria-label="${index + 1}번째 링크 별칭" placeholder="${escapeHtml(link.title || '별칭 입력')}" maxlength="100" value="${escapeHtml(link.alias)}">
          <span class="page-url" title="${escapeHtml(link.url)}">${escapeHtml(pageAddress(link.url))}</span></div><div class="link-actions">
          ${iconButton('move-up', 'up', '위로 이동', index === 0 ? 'disabled' : '')}
          ${iconButton('move-down', 'down', '아래로 이동', index === group.links.length - 1 ? 'disabled' : '')}
          ${iconButton('toggle-star', 'star', '즐겨찾기', `aria-pressed="${starred}"`, `star-toggle${starred ? ' is-starred' : ''}`)}
          ${iconButton('remove-link', 'trash', '링크 삭제')}</div></div>`;
      }).join('')}</div>` : ''}
      <div class="field"><span>태그 <small>선택</small></span><div class="tag-picker">${tags.map((tag) => `<button type="button" class="tag-chip" data-action="toggle-tag" data-tag-id="${escapeHtml(tag.id)}" aria-pressed="${group.tagIds.has(tag.id)}" style="--tile-color: ${color(tag.color)}">${renderSavedIcon(tag.icon)}${escapeHtml(tag.name)}</button>`).join('')}
      <button type="button" class="tag-chip" data-action="show-tag-editor" aria-expanded="${group.tag.visible}">${icon('plus')} 새 태그</button></div></div>
      ${group.tag.visible ? `<div class="tag-tools"><div class="field-row"><label class="field"><span>이름</span><input name="tag-name" maxlength="24" value="${escapeHtml(group.tag.name)}" placeholder="태그 이름"></label>
      <label class="field"><span>색</span><input type="color" name="tag-color" value="${color(group.tag.color)}"></label>
      <label class="field"><span>아이콘 <small>선택</small></span>${selectIcon('tag-icon', group.tag.icon)}</label></div>${iconUpload('tag-icon', group.tag.icon)}
      <button type="button" class="secondary-button" data-action="add-tag">태그 만들기</button></div>` : ''}
      <p class="form-error" role="alert" hidden></p>
    </form>${editorFooter('group-form', group.id ? '변경사항 저장' : '그룹 저장')}`;
  }
  editor.querySelector('.editor-body').scrollTop = scroll;
}

function formError(message, field) {
  const element = editor.querySelector('.form-error');
  element.textContent = message;
  element.hidden = false;
  if (field) editor.querySelector(field)?.focus();
  element.scrollIntoView({ block: 'nearest' });
}

function addLink(value, title = '') {
  const url = normalizeUrl(value);
  if (!url) {
    formError('올바른 웹페이지 주소를 입력해 주세요. 예: https://example.com', '[name="link-url"]');
    return false;
  }
  if (draft.group.links.some((link) => link.url === url)) {
    formError('이미 목록에 있는 웹페이지예요.', '[name="link-url"]');
    return false;
  }
  draft.group.links.push({ id: crypto.randomUUID(), url, alias: '', title });
  draft.group.linkUrl = '';
  return true;
}

function addTag() {
  const group = draft.group;
  const name = group.tag.name.trim();
  if (!name) {
    formError('태그 이름을 입력해 주세요.', '[name="tag-name"]');
    return false;
  }
  const existing = [...data.tags, ...group.newTags].find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  const tag = existing ?? { id: crypto.randomUUID(), name, color: color(group.tag.color), icon: group.tag.icon };
  if (!existing) group.newTags.push(tag);
  group.tagIds.add(tag.id);
  group.tag = { visible: false, name: '', color: '#d88c81', icon: '' };
  return true;
}

async function currentPage() {
  const windowFilter = detachedEditor ? { windowId: sourceWindowId ?? chrome.windows.WINDOW_ID_NONE } : { currentWindow: true };
  const [tab] = await chrome.tabs.query({ active: true, ...windowFilter }).catch(() => []);
  if (!tab || !/^https?:\/\//i.test(tab.url ?? '')) {
    throw new Error('현재 탭의 주소를 가져올 수 없어요. 주소창에서 주소를 복사해 붙여넣어 주세요.');
  }
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    if (injection?.result?.url) return injection.result;
  } catch {
    // Browser-protected web pages can still have a URL and title available through activeTab.
  }
  return { url: tab.url, title: tab.title ?? '' };
}

function upsertStar(stars, star) {
  const index = stars.findIndex((item) => item.url === star.url);
  if (index === -1) stars.unshift(star);
  else stars[index] = star;
}

async function saveGroup() {
  const group = draft.group;
  const name = group.name.trim();
  if (!name) return formError('그룹 이름을 입력해 주세요.', '[name="group-name"]');
  if (group.linkUrl.trim() && !addLink(group.linkUrl)) return;
  if (!group.links.length) return formError('그룹에 웹페이지를 한 개 이상 추가해 주세요.', '[name="link-url"]');
  if (group.tag.visible && group.tag.name.trim()) addTag();
  const links = group.links.map((link) => ({ ...link, alias: link.alias.trim() }));
  const updated = { id: group.id ?? draft.id, name, icon: group.icon, links, tagIds: [] };
  persistDraft();
  await updateData((next) => {
    const tagIds = new Set(group.tagIds);
    for (const tag of group.newTags) {
      const sameName = next.tags.find((item) => item.name.toLowerCase() === tag.name.toLowerCase());
      if (!sameName) next.tags.push(tag);
      else if (tagIds.delete(tag.id)) tagIds.add(sameName.id);
    }
    updated.tagIds = [...tagIds];
    const index = next.groups.findIndex((item) => item.id === updated.id);
    if (group.id && index === -1) throw new Error('이미 삭제된 그룹이에요.');
    if (index === -1) next.groups.unshift(updated);
    else next.groups[index] = updated;

    for (const [url, star] of group.starChanges) {
      if (star) upsertStar(next.stars, star);
      else next.stars = next.stars.filter((item) => item.url !== url);
    }
  });
  clearDraft();
  dialog.close();
  menuId = null;
  if (view === 'tags' && activeTagId && updated.tagIds.includes(activeTagId)) render();
  else setView('default');
  announce(group.id ? '그룹을 수정했어요.' : '탭 그룹을 저장했어요.');
}

async function saveStar() {
  const star = draft.star;
  const url = normalizeUrl(star.url);
  if (!url) return formError('올바른 웹페이지 주소를 입력해 주세요. 예: https://example.com', '[name="star-url"]');
  await updateData((next) => {
    const existing = next.stars.find((item) => item.url === url);
    upsertStar(next.stars, { url, alias: star.alias.trim() || existing?.alias || '', title: star.title || existing?.title || '' });
  });
  clearDraft();
  dialog.close();
  setView('starred');
  announce('즐겨찾기를 저장했어요.');
}

function nativeGroupColor(group) {
  const tag = data.tags.find((item) => item.id === group.tagIds[0]);
  if (!tag) return 'grey';
  const rgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const target = rgb(color(tag.color));
  const distance = (hex) => rgb(hex).reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0);
  return Object.entries(chromeColors).sort((first, second) => distance(first[1]) - distance(second[1]))[0][0];
}

async function openGroup(group) {
  if (opening) return;
  opening = true;
  const ids = [];
  try {
    const { id: windowId } = await chrome.windows.getCurrent();
    for (const link of group.links) {
      const tab = await chrome.tabs.create({ windowId, url: link.url, active: false });
      ids.push(tab.id);
    }
    const groupId = await chrome.tabs.group({ createProperties: { windowId }, tabIds: ids });
    await chrome.tabGroups.update(groupId, { title: group.name, color: nativeGroupColor(group) });
  } catch {
    if (ids.length) await Promise.allSettled(ids.map((id) => chrome.tabs.remove(id)));
    announce('탭 그룹을 열지 못했어요. 다시 시도해 주세요.');
    return;
  } finally {
    opening = false;
  }
  await chrome.tabs.update(ids[0], { active: true });
}

switcher.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-view]');
  if (tab) setView(tab.dataset.view);
});

switcher.addEventListener('keydown', (event) => {
  const tabs = [...switcher.querySelectorAll('[data-view]')];
  const index = tabs.indexOf(event.target);
  const moves = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
  const next = tabs[moves[event.key]];
  if (index === -1 || !next) return;
  event.preventDefault();
  setView(next.dataset.view);
  next.focus();
});

main.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const group = data.groups.find((item) => item.id === button.closest('[data-group-id]')?.dataset.groupId);
  try {
    switch (action) {
      case 'open-tag':
        activeTagId = button.dataset.tagId;
        render();
        main.scrollTop = 0;
        main.querySelector('[data-action="back-to-tags"]').focus({ preventScroll: true });
        break;
      case 'back-to-tags': {
        const previousTagId = activeTagId;
        setView('tags');
        main.querySelector(`[data-tag-id="${CSS.escape(previousTagId)}"]`)?.focus();
        break;
      }
      case 'expand-group':
        if (!expanded.delete(group.id)) expanded.add(group.id);
        menuId = null;
        render();
        main.querySelector(`[data-group-id="${CSS.escape(group.id)}"] .expand-button`)?.focus({ preventScroll: true });
        break;
      case 'show-group-menu':
        menuId = menuId === group.id ? null : group.id;
        render();
        positionGroupMenu();
        main.querySelector(`[data-group-id="${CSS.escape(group.id)}"] ${menuId ? '.context-menu button' : '.more-button'}`)?.focus({ preventScroll: true });
        break;
      case 'edit-group':
      case 'delete-group': {
        const trigger = button.closest('.group-card').querySelector('.more-button');
        openEditor(trigger, group, action === 'delete-group' ? 'delete' : 'group');
        break;
      }
      case 'open-group':
        await openGroup(group);
        break;
      case 'open-page':
        await chrome.tabs.create({ url: button.dataset.url });
        break;
      case 'remove-star':
        await updateData((next) => { next.stars = next.stars.filter((star) => star.url !== button.dataset.url); });
        render();
        announce('즐겨찾기를 해제했어요.');
        break;
    }
  } catch {
    announce('작업을 완료하지 못했어요. 다시 시도해 주세요.');
  }
});

document.addEventListener('click', (event) => {
  if (!menuId || dialog.open || event.target.closest('.context-menu, .more-button')) return;
  menuId = null;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || dialog.open || !menuId) return;
  const previousMenu = menuId;
  menuId = null;
  render();
  main.querySelector(`[data-group-id="${CSS.escape(previousMenu)}"] .more-button`)?.focus();
});

addButton.addEventListener('click', () => {
  openEditor(addButton).catch(() => announce('편집 화면을 열지 못했어요. 다시 시도해 주세요.'));
});

dialog.addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});

dialog.addEventListener('close', () => {
  draft = null;
  editor.replaceChildren();
  if (detachedEditor) {
    window.close();
    return;
  }
  if (dialogTrigger?.isConnected) dialogTrigger.focus();
  else addButton.focus();
  dialogTrigger = null;
});

editor.addEventListener('input', (event) => {
  const input = event.target;
  const group = draft.group;
  const { name, value } = input;
  const error = editor.querySelector('.form-error');
  if (error) error.hidden = true;

  if (input.hasAttribute('data-link-alias')) {
    const link = group.links.find((item) => item.id === input.closest('[data-link-id]').dataset.linkId);
    link.alias = value;
    if (linkIsStarred(link.url)) group.starChanges.set(link.url, { url: link.url, alias: value.trim(), title: link.title });
    persistDraft();
    return;
  }
  switch (name) {
    case 'group-name': group.name = value; break;
    case 'group-icon': group.icon = value; break;
    case 'link-url': group.linkUrl = value; break;
    case 'tag-name': group.tag.name = value; break;
    case 'tag-color': group.tag.color = value; break;
    case 'tag-icon': group.tag.icon = value; break;
    case 'star-url': draft.star.url = value; draft.star.title = ''; break;
    case 'star-alias': draft.star.alias = value; break;
    default: return;
  }
  persistDraft();
});

editor.addEventListener('click', (event) => {
  const button = event.target.closest('[data-choose-png]');
  if (button && !busy) editor.querySelector(`[data-icon-upload="${button.dataset.choosePng}"]`).click();
});

editor.addEventListener('change', async (event) => {
  const input = event.target;
  if (['group-icon', 'tag-icon'].includes(input.name)) {
    clearIconPreview(input);
    return;
  }

  const target = input.dataset.iconUpload;
  const file = input.files?.[0];
  if (!target || !file || busy) return;

  const button = editor.querySelector(`[data-choose-png="${target}"]`);
  const focusWasOnChooser = document.activeElement === button || document.activeElement === input;
  busy = true;
  button.disabled = true;
  try {
    const iconData = await readPngIcon(file);
    const owner = target === 'tag-icon' ? draft.group.tag : draft.group;
    owner.icon = iconData;
    persistDraft();
    renderEditor();
    if (focusWasOnChooser) editor.querySelector(`[data-choose-png="${target}"]`).focus({ preventScroll: true });
  } catch (error) {
    formError(error.message);
  } finally {
    input.value = '';
    button.disabled = false;
    busy = false;
  }
});

editor.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || !['link-url', 'tag-name'].includes(event.target.name)) return;
  event.preventDefault();
  editor.querySelector(`[data-action="${event.target.name === 'link-url' ? 'add-link' : 'add-tag'}"]`).click();
});

editor.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || busy) return;
  const action = button.dataset.action;
  const group = draft.group;
  switch (action) {
    case 'close-editor':
      dialog.close();
      return;
    case 'discard-draft':
      clearDraft();
      dialog.close();
      return;
    case 'open-editor-window':
      busy = true;
      button.disabled = true;
      try {
        await openEditorWindow(button.dataset.iconTarget);
      } catch {
        formError('별도 편집 창을 열지 못했어요. 다시 시도해 주세요.');
      } finally {
        button.disabled = false;
        busy = false;
      }
      return;
    case 'choose-group':
    case 'choose-starred':
      draft.mode = action === 'choose-group' ? 'group' : 'star';
      persistDraft();
      renderEditor(false);
      focusEditor();
      return;
    case 'add-link':
      if (addLink(group.linkUrl)) {
        persistDraft();
        renderEditor();
        editor.querySelector('[name="link-url"]').focus({ preventScroll: true });
      }
      return;
    case 'toggle-tag': {
      const id = button.dataset.tagId;
      if (!group.tagIds.delete(id)) group.tagIds.add(id);
      button.setAttribute('aria-pressed', String(group.tagIds.has(id)));
      persistDraft();
      return;
    }
    case 'show-tag-editor':
      group.tag.visible = !group.tag.visible;
      persistDraft();
      renderEditor();
      editor.querySelector(group.tag.visible ? '[name="tag-name"]' : '[data-action="show-tag-editor"]').focus();
      return;
    case 'add-tag':
      if (addTag()) {
        persistDraft();
        renderEditor();
        editor.querySelector('[data-action="show-tag-editor"]').focus();
      }
      return;
    case 'toggle-star':
    case 'move-up':
    case 'move-down':
    case 'remove-link': {
      const id = button.closest('[data-link-id]').dataset.linkId;
      const index = group.links.findIndex((link) => link.id === id);
      const link = group.links[index];
      if (action === 'toggle-star') {
        const starred = !linkIsStarred(link.url);
        const existing = data.stars.find((star) => star.url === link.url);
        group.starChanges.set(link.url, starred ? { url: link.url, alias: link.alias.trim() || existing?.alias || '', title: link.title || existing?.title || '' } : null);
        button.setAttribute('aria-pressed', String(starred));
        button.classList.toggle('is-starred', starred);
        persistDraft();
        return;
      }
      group.links.splice(index, 1);
      if (action !== 'remove-link') group.links.splice(index + (action === 'move-up' ? -1 : 1), 0, link);
      persistDraft();
      renderEditor();
      const row = editor.querySelector(`[data-link-id="${CSS.escape(id)}"]`);
      const focusTarget = row?.querySelector(`[data-action="${action}"]:not(:disabled)`) ?? row?.querySelector('[data-link-alias]') ?? editor.querySelector('[name="link-url"]');
      focusTarget?.focus({ preventScroll: true });
      return;
    }
    case 'current-page':
      busy = true;
      button.disabled = true;
      try {
        const page = await currentPage();
        if (draft.mode === 'star') {
          draft.star = { ...draft.star, url: page.url, title: page.title };
          persistDraft();
          renderEditor();
          editor.querySelector('[name="star-alias"]').focus();
        } else if (addLink(page.url, page.title)) {
          persistDraft();
          renderEditor();
          editor.querySelector('[name="link-url"]').focus();
        }
      } catch (error) {
        formError(error.message);
      } finally {
        button.disabled = false;
        busy = false;
      }
      return;
    case 'confirm-delete':
      busy = true;
      button.disabled = true;
      try {
        const id = draft.groupToDelete.id;
        await updateData((next) => { next.groups = next.groups.filter((item) => item.id !== id); });
        loadDraft();
        expanded.delete(id);
        menuId = null;
        dialog.close();
        render();
        announce('탭 그룹을 삭제했어요.');
      } catch {
        formError('삭제하지 못했어요. 다시 시도해 주세요.');
      } finally {
        button.disabled = false;
        busy = false;
      }
      break;
  }
});

editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const submit = editor.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (event.target.id === 'group-form') await saveGroup();
    else await saveStar();
  } catch {
    renderEditor();
    formError('저장하지 못했어요. 다시 시도해 주세요.');
  } finally {
    submit.disabled = false;
    busy = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[storageKey]) return;
  data = readData({ [storageKey]: changes[storageKey].newValue });
  render();
});

chrome.storage.local.get(storageKey).then((result) => {
  data = readData(result);
  render();
  const pending = loadDraft();
  if (detachedEditor) {
    showEditor(addButton, pending || makeDraft());
  } else if (pending && !findEditorWindow()) {
    showEditor(addButton, pending);
  }
}).catch(() => announce('저장된 항목을 불러오지 못했어요. 팝업을 다시 열어 주세요.'));
