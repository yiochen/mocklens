import type { MocklensNote, NotesLedger } from './notes.js';
import type { Device } from './types.js';

interface ViewerData {
  screens: string[];
  devices: Device[];
}

interface PickedTarget {
  screen: string;
  device: string;
  selector: string;
  element: { tag: string; text: string };
  viewport: { width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Browser-only viewer application. It is serialized into the generated viewer
 * page, so every helper it uses must remain inside this function.
 */
export function runViewer(DATA: ViewerData): void {
  const screens = DATA.screens;
  const devices = DATA.devices;
  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const nav = byId<HTMLElement>('screens');
  const frame = byId<HTMLIFrameElement>('frame');
  const sizeLabel = byId<HTMLElement>('size');
  const rawLink = byId<HTMLAnchorElement>('raw');
  const deviceSel = byId<HTMLSelectElement>('device');
  const stage = byId<HTMLElement>('stage');
  const scaler = byId<HTMLElement>('scaler');
  const bezel = byId<HTMLElement>('bezel');
  const annotateButton = byId<HTMLButtonElement>('annotate');
  const notesCount = byId<HTMLElement>('notes-count');
  const notesNotice = byId<HTMLElement>('notes-notice');
  const openNotes = byId<HTMLElement>('open-notes');
  const resolvedNotes = byId<HTMLElement>('resolved-notes');
  const resolvedDetails = byId<HTMLDetailsElement>('resolved-details');
  const resolvedSummary = byId<HTMLElement>('resolved-summary');
  const selectAllButton = byId<HTMLButtonElement>('select-all-open');
  const clearSelectionButton = byId<HTMLButtonElement>('clear-selection');
  const batchBar = byId<HTMLElement>('batch-bar');
  const batchCount = byId<HTMLElement>('batch-count');
  const copySelectedButton = byId<HTMLButtonElement>('copy-selected');
  const resolveSelectedButton = byId<HTMLButtonElement>('resolve-selected');
  const deleteSelectedButton = byId<HTMLButtonElement>('delete-selected');
  const composer = byId<HTMLElement>('note-composer');
  const composerTitle = byId<HTMLElement>('composer-title');
  const composerTarget = byId<HTMLElement>('composer-target');
  const composerMessage = byId<HTMLTextAreaElement>('composer-message');
  const composerSave = byId<HTMLButtonElement>('composer-save');
  const composerCancel = byId<HTMLButtonElement>('composer-cancel');
  const copyDialog = byId<HTMLDialogElement>('copy-dialog');
  const copyPreview = byId<HTMLTextAreaElement>('copy-preview');
  const copyDialogClose = byId<HTMLButtonElement>('copy-dialog-close');
  const toast = byId<HTMLElement>('toast');
  const STAGE_PAD = 28;
  const BEZEL_PAD = 14;
  let devW = 0;
  let devH = 0;
  let notes: MocklensNote[] = [];
  let annotateMode = false;
  let activeNoteId: string | null = null;
  let pendingTarget: PickedTarget | null = null;
  let editingNoteId: string | null = null;
  let frameCleanup: (() => void) | null = null;
  let hoverTarget: Element | null = null;
  let focusTarget: Element | null = null;
  let hoverBox: HTMLElement | null = null;
  let focusBox: HTMLElement | null = null;
  const selected = new Set<string>();

  function fit(): void {
    if (!devW || !devH) return;
    const bezelW = devW + BEZEL_PAD * 2;
    const bezelH = devH + BEZEL_PAD * 2;
    bezel.style.width = `${bezelW}px`;
    bezel.style.height = `${bezelH}px`;
    const availW = stage.clientWidth - STAGE_PAD * 2;
    const availH = stage.clientHeight - STAGE_PAD * 2;
    let scale = Math.min(availW / bezelW, availH / bezelH, 1);
    if (!(scale > 0)) scale = 1;
    bezel.style.transform = scale === 1 ? '' : `scale(${scale})`;
    scaler.style.width = `${Math.round(bezelW * scale)}px`;
    scaler.style.height = `${Math.round(bezelH * scale)}px`;
    sizeLabel.textContent = `${devW} × ${devH}${scale < 0.995 ? ` · ${Math.round(scale * 100)}%` : ''}`;
  }

  function hashFor(screen: string, device: string): string {
    return `#${encodeURIComponent(screen)}/${encodeURIComponent(device)}`;
  }

  function encPath(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
  }

  function current(): { screen: string; device: string } {
    let screen = screens[0] ?? '';
    let device = devices[0]?.name ?? '';
    const raw = location.hash.slice(1);
    if (raw) {
      const index = raw.lastIndexOf('/');
      let screenPart = raw;
      let devicePart = '';
      if (index >= 0) {
        screenPart = raw.slice(0, index);
        devicePart = raw.slice(index + 1);
      }
      try {
        screenPart = decodeURIComponent(screenPart);
        devicePart = decodeURIComponent(devicePart);
      } catch {
        // Invalid hashes fall back to the first configured screen/device.
      }
      if (screens.includes(screenPart)) screen = screenPart;
      if (devices.some((candidate) => candidate.name === devicePart)) device = devicePart;
    }
    return { screen, device };
  }

  function deviceNamed(name: string): Device | undefined {
    return devices.find((device) => device.name === name);
  }

  function setNotice(message: string, kind: 'error' | 'info' = 'error'): void {
    notesNotice.textContent = message;
    notesNotice.className = `notice ${kind}`;
    notesNotice.hidden = message === '';
  }

  function showToast(message: string): void {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  async function request(url: string, options: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        // Keep the HTTP status when the response was not JSON.
      }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    if ((response.headers.get('content-type') ?? '').startsWith('text/')) return response.text();
    return response.json();
  }

  function queueOrder(items: MocklensNote[]): MocklensNote[] {
    const order = new Map(screens.map((screen, index) => [screen, index]));
    return items
      .map((note, index) => ({ note, index }))
      .sort((a, b) => {
        const aScreen = order.get(a.note.screen) ?? Number.MAX_SAFE_INTEGER;
        const bScreen = order.get(b.note.screen) ?? Number.MAX_SAFE_INTEGER;
        if (aScreen !== bScreen) return aScreen - bScreen;
        if (a.note.screen !== b.note.screen) return a.note.screen.localeCompare(b.note.screen);
        const time = a.note.createdAt.localeCompare(b.note.createdAt);
        return time !== 0 ? time : a.index - b.index;
      })
      .map(({ note }) => note);
  }

  function selectedIdsInDisplayOrder(): string[] {
    return [
      ...queueOrder(notes.filter((note) => note.status === 'open')),
      ...queueOrder(notes.filter((note) => note.status === 'resolved')),
    ]
      .filter((note) => selected.has(note.id))
      .map((note) => note.id);
  }

  async function loadNotes(): Promise<void> {
    try {
      const ledger = (await request('/api/notes')) as NotesLedger;
      notes = ledger.notes;
      for (const id of [...selected]) {
        if (!notes.some((note) => note.id === id)) selected.delete(id);
      }
      setNotice('');
    } catch (error) {
      notes = [];
      setNotice(error instanceof Error ? error.message : String(error));
    }
    renderNotes();
    updateFrameDecorations();
  }

  function setAnnotate(enabled: boolean): void {
    annotateMode = enabled;
    annotateButton.setAttribute('aria-pressed', String(enabled));
    annotateButton.classList.toggle('active', enabled);
    annotateButton.textContent = enabled ? 'Annotating' : 'Annotate';
    if (!enabled) {
      hoverTarget = null;
      focusTarget = null;
    } else if (activeNoteId !== null) {
      focusActiveNote();
    }
    updateFrameDecorations();
  }

  function render(): void {
    const selection = current();
    const device = deviceNamed(selection.device) ?? devices[0];
    if (!selection.screen || device === undefined) return;
    const framePath = `/screens/${encPath(selection.screen)}`;
    if (frame.dataset.screen !== selection.screen) {
      frame.dataset.screen = selection.screen;
      frame.src = framePath;
    }
    frame.style.width = `${device.width}px`;
    frame.style.height = `${device.height}px`;
    devW = device.width;
    devH = device.height;
    fit();
    rawLink.href = framePath;
    deviceSel.value = device.name;
    for (const link of Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'))) {
      const name = link.dataset.screen ?? '';
      link.className = name === selection.screen ? 'active' : '';
      link.href = hashFor(name, device.name);
    }
    if (location.hash !== hashFor(selection.screen, device.name)) {
      history.replaceState(null, '', hashFor(selection.screen, device.name));
    }
    renderNotes();
    updateFrameDecorations();
  }

  function makeButton(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void action();
    });
    return button;
  }

  function noteActionError(error: unknown): void {
    setNotice(error instanceof Error ? error.message : String(error));
  }

  async function setNoteStatus(note: MocklensNote, status: 'open' | 'resolved'): Promise<void> {
    try {
      await request(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadNotes();
    } catch (error) {
      noteActionError(error);
    }
  }

  async function removeNote(note: MocklensNote): Promise<void> {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      await request(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
      selected.delete(note.id);
      if (activeNoteId === note.id) activeNoteId = null;
      await loadNotes();
    } catch (error) {
      noteActionError(error);
    }
  }

  function editNote(note: MocklensNote): void {
    void activateNote(note).then(() => {
      pendingTarget = null;
      editingNoteId = note.id;
      composerTitle.textContent = 'Edit note';
      composerTarget.textContent = `${note.screen} · ${note.element.tag} · ${note.selector}`;
      composerMessage.value = note.message;
      composer.hidden = false;
      composerMessage.focus();
      composerMessage.select();
    });
  }

  function noteCard(note: MocklensNote): HTMLElement {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.classList.toggle('active', note.id === activeNoteId);
    card.tabIndex = 0;
    card.dataset.noteId = note.id;
    card.addEventListener('click', () => void activateNote(note));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void activateNote(note);
      }
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(note.id);
    checkbox.setAttribute('aria-label', `Select note: ${note.message}`);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(note.id);
      else selected.delete(note.id);
      renderNotes();
    });

    const content = document.createElement('div');
    content.className = 'note-content';
    const message = document.createElement('p');
    message.textContent = note.message;
    const target = document.createElement('p');
    target.className = 'note-meta';
    const text = note.element.text === '' ? `<${note.element.tag}>` : `<${note.element.tag}> “${note.element.text}”`;
    target.textContent = `${note.device} · ${text}`;
    content.append(message, target);

    const actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.append(
      makeButton('Edit', 'quiet', () => editNote(note)),
      makeButton(note.status === 'open' ? 'Resolve' : 'Reopen', 'quiet', () =>
        setNoteStatus(note, note.status === 'open' ? 'resolved' : 'open'),
      ),
      makeButton('Delete', 'quiet danger-text', () => removeNote(note)),
    );
    content.append(actions);
    card.append(checkbox, content);
    return card;
  }

  function renderGroups(container: HTMLElement, items: MocklensNote[], emptyText: string): void {
    container.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-notes';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    const ordered = queueOrder(items);
    let lastScreen = '';
    for (const note of ordered) {
      if (note.screen !== lastScreen) {
        const heading = document.createElement('h3');
        heading.className = 'screen-group';
        heading.textContent = note.screen;
        container.appendChild(heading);
        lastScreen = note.screen;
      }
      container.appendChild(noteCard(note));
    }
  }

  function renderNotes(): void {
    const resolvedOpen = resolvedDetails.open;
    const open = notes.filter((note) => note.status === 'open');
    const resolved = notes.filter((note) => note.status === 'resolved');
    notesCount.textContent = `${open.length} open`;
    resolvedSummary.textContent = `Resolved (${resolved.length})`;
    renderGroups(openNotes, open, 'No open notes yet.');
    renderGroups(resolvedNotes, resolved, 'No resolved notes.');
    resolvedDetails.open = resolvedOpen;

    const validIds = new Set(notes.map((note) => note.id));
    for (const id of [...selected]) {
      if (!validIds.has(id)) selected.delete(id);
    }
    clearSelectionButton.disabled = selected.size === 0;
    selectAllButton.disabled = open.length === 0;
    batchBar.hidden = selected.size === 0;
    batchCount.textContent = `${selected.size} selected`;
    resolveSelectedButton.disabled = !notes.some((note) => selected.has(note.id) && note.status === 'open');
  }

  function hideComposer(): void {
    composer.hidden = true;
    pendingTarget = null;
    editingNoteId = null;
    composerMessage.value = '';
  }

  async function saveComposer(): Promise<void> {
    const message = composerMessage.value.trim();
    if (message === '') {
      composerMessage.focus();
      return;
    }
    composerSave.disabled = true;
    try {
      if (editingNoteId !== null) {
        await request(`/api/notes/${encodeURIComponent(editingNoteId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ message }),
        });
      } else if (pendingTarget !== null) {
        const created = (await request('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ ...pendingTarget, message }),
        })) as MocklensNote;
        selected.clear();
        selected.add(created.id);
        activeNoteId = created.id;
      }
      hideComposer();
      await loadNotes();
      focusActiveNote();
    } catch (error) {
      noteActionError(error);
    } finally {
      composerSave.disabled = false;
    }
  }

  function showCreateComposer(target: PickedTarget): void {
    pendingTarget = target;
    editingNoteId = null;
    composerTitle.textContent = 'Add note';
    const text = target.element.text === '' ? `<${target.element.tag}>` : `<${target.element.tag}> “${target.element.text}”`;
    composerTarget.textContent = `${target.screen} · ${text} · ${target.selector}`;
    composerMessage.value = '';
    composer.hidden = false;
    composerMessage.focus();
  }

  async function activateNote(note: MocklensNote): Promise<void> {
    activeNoteId = note.id;
    hideComposer();
    setAnnotate(true);
    if (!screens.includes(note.screen) || !devices.some((device) => device.name === note.device)) {
      focusTarget = null;
      setNotice(`Screen or device no longer found for note on ${note.screen}.`);
      renderNotes();
      updateFrameDecorations();
      return;
    }
    const desired = hashFor(note.screen, note.device);
    if (location.hash !== desired) {
      location.hash = desired;
    } else {
      render();
      focusActiveNote();
    }
    renderNotes();
  }

  function semanticTarget(raw: Element): Element {
    const action = raw.closest(
      '[data-mocklens-action],button,a,input,select,textarea,label,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"]',
    );
    if (action !== null) return action;
    if (raw.closest('svg') !== null && ['svg', 'path', 'use', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon'].includes(raw.tagName.toLowerCase())) {
      return raw.closest('svg')!;
    }
    const semantic = raw.closest(
      'li,article,section,header,footer,nav,main,form,fieldset,dialog,[role],[data-mocklens-action]',
    );
    return semantic ?? raw;
  }

  function selectorFor(element: Element, doc: Document): string {
    const cssEscape = (value: string): string =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
    if (element.id !== '') {
      const idSelector = `#${cssEscape(element.id)}`;
      if (doc.querySelectorAll(idSelector).length === 1) return idSelector;
    }
    const segments: string[] = [];
    let currentElement: Element | null = element;
    while (currentElement !== null && currentElement !== doc.documentElement) {
      let segment = currentElement.tagName.toLowerCase();
      const classes = Array.from(currentElement.classList)
        .filter((className) => !className.startsWith('mocklens-review'))
        .slice(0, 2);
      if (classes.length > 0) segment += classes.map((className) => `.${cssEscape(className)}`).join('');
      const parent: Element | null = currentElement.parentElement;
      if (parent !== null) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === currentElement!.tagName);
        if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(currentElement) + 1})`;
      }
      segments.unshift(segment);
      const selector = segments.join(' > ');
      try {
        if (doc.querySelectorAll(selector).length === 1) return selector;
      } catch {
        // Continue building a more explicit path.
      }
      currentElement = parent;
    }
    return segments.join(' > ');
  }

  function targetSnapshot(element: Element): PickedTarget {
    const selection = current();
    const rect = element.getBoundingClientRect();
    const doc = element.ownerDocument;
    return {
      screen: selection.screen,
      device: selection.device,
      selector: selectorFor(element, doc),
      element: {
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      },
      viewport: { width: doc.defaultView?.innerWidth ?? devW, height: doc.defaultView?.innerHeight ?? devH },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }

  function safeQuery(doc: Document, selector: string): Element | null {
    try {
      return doc.querySelector(selector);
    } catch {
      return null;
    }
  }

  function positionBox(box: HTMLElement | null, target: Element | null, visible: boolean): void {
    if (box === null || target === null || !visible) {
      if (box !== null) box.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function notesForCurrentScreen(): MocklensNote[] {
    const selection = current();
    return [
      ...queueOrder(notes.filter((note) => note.status === 'open')),
      ...queueOrder(notes.filter((note) => note.status === 'resolved')),
    ].filter((note) => note.screen === selection.screen && note.device === selection.device);
  }

  function updateFrameDecorations(): void {
    const doc = frame.contentDocument;
    if (doc === null || doc.body === null || hoverBox === null || focusBox === null) return;
    positionBox(hoverBox, hoverTarget, annotateMode && hoverTarget !== focusTarget);
    positionBox(focusBox, focusTarget, annotateMode);
    for (const pin of Array.from(doc.querySelectorAll('[data-mocklens-review-pin]'))) pin.remove();
    notesForCurrentScreen().forEach((note, index) => {
      const target = safeQuery(doc, note.selector);
      if (target === null) return;
      const rect = target.getBoundingClientRect();
      const pin = doc.createElement('button');
      pin.type = 'button';
      pin.dataset.mocklensReviewUi = 'true';
      pin.dataset.mocklensReviewPin = note.id;
      pin.className = `mocklens-review-pin ${note.status}`;
      pin.textContent = String(index + 1);
      pin.setAttribute('aria-label', `Open note ${index + 1}: ${note.message}`);
      pin.style.left = `${Math.max(2, Math.min((doc.defaultView?.innerWidth ?? devW) - 24, rect.right - 11))}px`;
      pin.style.top = `${Math.max(2, rect.top - 11)}px`;
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void activateNote(note);
      });
      doc.body.appendChild(pin);
    });
  }

  function focusActiveNote(): void {
    if (!annotateMode || activeNoteId === null) return;
    const note = notes.find((candidate) => candidate.id === activeNoteId);
    const doc = frame.contentDocument;
    if (note === undefined || doc === null || frame.dataset.screen !== note.screen) return;
    const target = safeQuery(doc, note.selector);
    if (target === null) {
      focusTarget = null;
      setNotice(`Target no longer found for note on ${note.screen}.`);
      updateFrameDecorations();
      return;
    }
    setNotice('');
    focusTarget = target;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    window.setTimeout(updateFrameDecorations, 0);
  }

  function installFrameReview(): void {
    frameCleanup?.();
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null || doc.body === null) return;
    const style = doc.createElement('style');
    style.dataset.mocklensReviewUi = 'true';
    style.textContent = `
      [data-mocklens-review-ui] { box-sizing: border-box !important; }
      .mocklens-review-box {
        position: fixed !important; z-index: 2147483645 !important; pointer-events: none !important;
        border: 2px solid #2563eb !important; background: rgba(37, 99, 235, .08) !important;
        border-radius: 4px !important;
      }
      .mocklens-review-box.focus {
        border-color: #e11d48 !important; background: rgba(225, 29, 72, .10) !important;
        box-shadow: 0 0 0 3px rgba(225, 29, 72, .18) !important;
      }
      .mocklens-review-pin {
        position: fixed !important; z-index: 2147483646 !important; width: 22px !important; height: 22px !important;
        padding: 0 !important; border: 2px solid white !important; border-radius: 999px !important;
        background: #e11d48 !important; color: white !important; font: 700 11px/18px -apple-system, sans-serif !important;
        box-shadow: 0 2px 6px rgba(0,0,0,.3) !important; cursor: pointer !important;
      }
      .mocklens-review-pin.resolved { background: #64748b !important; opacity: .8 !important; }
    `;
    doc.head.appendChild(style);
    hoverBox = doc.createElement('div');
    hoverBox.className = 'mocklens-review-box';
    hoverBox.dataset.mocklensReviewUi = 'true';
    hoverBox.hidden = true;
    focusBox = doc.createElement('div');
    focusBox.className = 'mocklens-review-box focus';
    focusBox.dataset.mocklensReviewUi = 'true';
    focusBox.hidden = true;
    doc.body.append(hoverBox, focusBox);

    const onMove = (event: MouseEvent): void => {
      if (!annotateMode || event.target === null || (event.target as Node).nodeType !== 1) return;
      const target = event.target as Element;
      if (target.closest('[data-mocklens-review-ui]') !== null) return;
      hoverTarget = semanticTarget(target);
      updateFrameDecorations();
    };
    const onLeave = (): void => {
      hoverTarget = null;
      updateFrameDecorations();
    };
    const onClick = (event: MouseEvent): void => {
      if (!annotateMode || event.target === null || (event.target as Node).nodeType !== 1) return;
      const rawTarget = event.target as Element;
      if (rawTarget.closest('[data-mocklens-review-ui]') !== null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = semanticTarget(rawTarget);
      activeNoteId = null;
      focusTarget = target;
      hoverTarget = null;
      showCreateComposer(targetSnapshot(target));
      updateFrameDecorations();
      renderNotes();
    };
    const onPositionChange = (): void => updateFrameDecorations();
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseleave', onLeave, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('scroll', onPositionChange, true);
    win.addEventListener('resize', onPositionChange);
    frameCleanup = () => {
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseleave', onLeave, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('scroll', onPositionChange, true);
      win.removeEventListener('resize', onPositionChange);
    };
    updateFrameDecorations();
    focusActiveNote();
  }

  async function copySelected(): Promise<void> {
    try {
      const markdown = (await request('/api/notes/markdown', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIdsInDisplayOrder() }),
      })) as string;
      try {
        if (navigator.clipboard === undefined) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(markdown);
        showToast(`Copied ${selected.size} note${selected.size === 1 ? '' : 's'}`);
      } catch {
        copyPreview.value = markdown;
        copyDialog.showModal();
        copyPreview.focus();
        copyPreview.select();
      }
    } catch (error) {
      noteActionError(error);
    }
  }

  async function batchAction(action: 'resolve' | 'delete'): Promise<void> {
    const ids = selectedIdsInDisplayOrder();
    if (ids.length === 0) return;
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} selected note${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    try {
      const ledger = (await request('/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      })) as NotesLedger;
      notes = ledger.notes;
      selected.clear();
      if (activeNoteId !== null && !notes.some((note) => note.id === activeNoteId)) activeNoteId = null;
      renderNotes();
      updateFrameDecorations();
    } catch (error) {
      noteActionError(error);
    }
  }

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.name;
    option.textContent = `${device.name} (${device.width}×${device.height})`;
    deviceSel.appendChild(option);
  });
  if (screens.length === 0) nav.textContent = 'no screens found';
  screens.forEach((name) => {
    const link = document.createElement('a');
    link.textContent = name;
    link.dataset.screen = name;
    nav.appendChild(link);
  });

  annotateButton.addEventListener('click', () => setAnnotate(!annotateMode));
  deviceSel.addEventListener('change', () => {
    const selection = current();
    location.hash = hashFor(selection.screen, deviceSel.value);
  });
  selectAllButton.addEventListener('click', () => {
    selected.clear();
    notes.filter((note) => note.status === 'open').forEach((note) => selected.add(note.id));
    renderNotes();
  });
  clearSelectionButton.addEventListener('click', () => {
    selected.clear();
    renderNotes();
  });
  composerSave.addEventListener('click', () => void saveComposer());
  composerCancel.addEventListener('click', hideComposer);
  composerMessage.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveComposer();
    }
  });
  copySelectedButton.addEventListener('click', () => void copySelected());
  resolveSelectedButton.addEventListener('click', () => void batchAction('resolve'));
  deleteSelectedButton.addEventListener('click', () => void batchAction('delete'));
  copyDialogClose.addEventListener('click', () => copyDialog.close());
  frame.addEventListener('load', installFrameReview);
  window.addEventListener('hashchange', render);
  window.addEventListener('resize', fit);
  window.addEventListener('beforeunload', () => frameCleanup?.());
  render();
  void loadNotes();
}
