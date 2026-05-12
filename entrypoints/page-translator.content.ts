import { browser } from 'wxt/browser';
import {
  BACKGROUND_MESSAGE_TYPES,
  PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES,
  type PageTranslatorContentMessage,
  type PageTranslatorContentResponse,
  type TranslatePageTextsResponse,
} from '../lib/messages.ts';
import {
  loadPageTranslatorSettings,
  type PageTranslatorMode,
  type PageTranslatorSiteRule,
} from '../lib/page-translator-settings.ts';

const BALANCED_BATCH_MAX_CHARACTERS = 3200;
const BALANCED_BATCH_MAX_ITEMS = 24;
const BALANCED_MAX_CONCURRENT_BATCHES = 2;
const BALANCED_ROOT_MARGIN = '640px';
const TURBO_BATCH_MAX_CHARACTERS = 6400;
const TURBO_BATCH_MAX_ITEMS = 48;
const TURBO_MAX_CONCURRENT_BATCHES = 4;
const TURBO_ROOT_MARGIN = '1200px';
const MAX_UNIT_CHARACTERS = 4200;
const MUTATION_SCAN_DELAY_MS = 180;
const OVERLAY_HOST_ID = 'open-translator-page-status';
const STYLE_ID = 'open-translator-page-style';

const BASE_SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'video',
  'audio',
  'textarea',
  'input',
  'select',
  'option',
  'template',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[translate="no"]',
  '.notranslate',
  '[aria-hidden="true"]',
  `[data-open-translator-page="translation"]`,
  `#${OVERLAY_HOST_ID}`,
].join(',');

const PREFERRED_UNIT_TAGS = new Set([
  'A',
  'BUTTON',
  'CAPTION',
  'DD',
  'DT',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LEGEND',
  'LI',
  'P',
  'SUMMARY',
  'TD',
  'TH',
]);

const STRUCTURAL_CONTAINER_TAGS = new Set([
  'ARTICLE',
  'ASIDE',
  'BODY',
  'DL',
  'FOOTER',
  'FORM',
  'HEADER',
  'HTML',
  'MAIN',
  'NAV',
  'OL',
  'SECTION',
  'TABLE',
  'TBODY',
  'TFOOT',
  'THEAD',
  'TR',
  'UL',
]);

const INLINE_PLACEHOLDER_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'CITE',
  'CODE',
  'DEL',
  'DFN',
  'EM',
  'I',
  'INS',
  'KBD',
  'MARK',
  'Q',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
]);

type SelectorRules = {
  includeSelectors: string[];
  skipSelectors: string[];
};

type TranslationUnit = {
  element: HTMLElement;
  id: number;
  originalChildren: Node[];
  placeholders: Map<string, HTMLElement>;
  source: string;
};

type RestoreRecord =
  | {
      mode: 'replace';
      originalChildren: Node[];
      unitElement: HTMLElement;
    }
  | {
      mode: 'bilingual';
      unitElement: HTMLElement;
      wrapper: HTMLElement;
    };

type TranslationSession = {
  activeBatchCount: number;
  batchMaxCharacters: number;
  batchMaxItems: number;
  cancelled: boolean;
  completedCount: number;
  id: number;
  intersectionObserver: IntersectionObserver;
  maxConcurrentBatches: number;
  mode: PageTranslatorMode;
  mutationObserver: MutationObserver;
  observedElements: WeakSet<HTMLElement>;
  processedElements: WeakSet<HTMLElement>;
  queue: TranslationUnit[];
  rules: SelectorRules;
  scanTimer: number | null;
  totalCount: number;
  translatedCount: number;
  turboMode: boolean;
};

let nextTextId = 1;
let nextSessionId = 1;
let currentSession: TranslationSession | null = null;
let restoreRecords = new Map<HTMLElement, RestoreRecord>();

let overlayHost: HTMLElement | null = null;
let overlayTitle: HTMLElement | null = null;
let overlayDetail: HTMLElement | null = null;
let overlayProgress: HTMLProgressElement | null = null;
let overlayCancelButton: HTMLButtonElement | null = null;
let overlayRestoreButton: HTMLButtonElement | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPageTranslatorMessage(
  value: unknown,
): value is PageTranslatorContentMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  return Object.values(PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES).includes(
    value.type as (typeof PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES)[keyof typeof PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES],
  );
}

function normalizeTextForRequest(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function hasLanguageText(text: string) {
  return /\p{L}/u.test(text);
}

function isProbablyNonContent(text: string) {
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[\d\s.,:;+\-*/()[\]{}'"!?@#$%^&_=|\\<>~`]+$/.test(text)) return true;
  return false;
}

function splitSelectors(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function normalizeRules(rule?: PageTranslatorSiteRule): SelectorRules {
  return {
    includeSelectors: splitSelectors(rule?.includeSelectors ?? ''),
    skipSelectors: splitSelectors(rule?.skipSelectors ?? ''),
  };
}

function getPerformanceConfig(turboMode: boolean) {
  return turboMode
    ? {
        batchMaxCharacters: TURBO_BATCH_MAX_CHARACTERS,
        batchMaxItems: TURBO_BATCH_MAX_ITEMS,
        maxConcurrentBatches: TURBO_MAX_CONCURRENT_BATCHES,
        rootMargin: TURBO_ROOT_MARGIN,
      }
    : {
        batchMaxCharacters: BALANCED_BATCH_MAX_CHARACTERS,
        batchMaxItems: BALANCED_BATCH_MAX_ITEMS,
        maxConcurrentBatches: BALANCED_MAX_CONCURRENT_BATCHES,
        rootMargin: BALANCED_ROOT_MARGIN,
      };
}

function matchesSelector(element: Element, selector: string) {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function closestSelector(element: Element, selector: string) {
  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

function querySelectorList(root: ParentNode, selectors: string[]) {
  const matches = new Set<HTMLElement>();

  for (const selector of selectors) {
    try {
      root.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement) {
          matches.add(element);
        }
      });
    } catch {
      // Ignore invalid site-specific selectors.
    }
  }

  return Array.from(matches);
}

function hasRuleMatch(element: Element, selectors: string[]) {
  return selectors.some((selector) => matchesSelector(element, selector));
}

function hasRuleAncestor(element: Element, selectors: string[]) {
  return selectors.some((selector) => closestSelector(element, selector));
}

function isElementVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }

  return element.getClientRects().length > 0;
}

function isSkippedElement(element: HTMLElement, rules: SelectorRules) {
  if (closestSelector(element, BASE_SKIP_SELECTOR)) {
    return true;
  }

  const translatedUnit = element.closest('[data-open-translator-page-unit="true"]');
  if (translatedUnit && translatedUnit !== element) {
    return true;
  }

  return hasRuleMatch(element, rules.skipSelectors) ||
    hasRuleAncestor(element, rules.skipSelectors);
}

function getVisibleText(element: HTMLElement) {
  return normalizeTextForRequest(element.textContent ?? '');
}

function getDirectText(element: HTMLElement) {
  return normalizeTextForRequest(
    Array.from(element.childNodes)
      .map((node) => (node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : ''))
      .join(' '),
  );
}

function isBlockLike(element: HTMLElement) {
  const display = window.getComputedStyle(element).display;
  return (
    display === 'block' ||
    display === 'flex' ||
    display === 'grid' ||
    display === 'list-item' ||
    display === 'table-cell' ||
    display === 'table-caption'
  );
}

function hasNestedPreferredCandidate(element: HTMLElement, rules: SelectorRules) {
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement) || isSkippedElement(child, rules)) {
      continue;
    }

    const text = getVisibleText(child);
    if (
      text.length >= 2 &&
      PREFERRED_UNIT_TAGS.has(child.tagName.toUpperCase()) &&
      hasLanguageText(text)
    ) {
      return true;
    }

    if (hasNestedPreferredCandidate(child, rules)) {
      return true;
    }
  }

  return false;
}

function isCandidateElement(element: HTMLElement, rules: SelectorRules) {
  if (isSkippedElement(element, rules) || !isElementVisible(element)) {
    return false;
  }

  const text = getVisibleText(element);
  if (
    text.length < 2 ||
    text.length > MAX_UNIT_CHARACTERS ||
    !hasLanguageText(text) ||
    isProbablyNonContent(text)
  ) {
    return false;
  }

  const tagName = element.tagName.toUpperCase();
  if (STRUCTURAL_CONTAINER_TAGS.has(tagName)) {
    return false;
  }

  if (PREFERRED_UNIT_TAGS.has(tagName)) {
    return !hasNestedPreferredCandidate(element, rules);
  }

  if (!isBlockLike(element)) {
    return false;
  }

  return getDirectText(element).length > 0 && !hasNestedPreferredCandidate(element, rules);
}

function getScanRoots(rules: SelectorRules) {
  if (rules.includeSelectors.length > 0) {
    return querySelectorList(document, rules.includeSelectors);
  }

  return document.body ? [document.body] : [];
}

function collectCandidateElements(root: HTMLElement, rules: SelectorRules) {
  const rawCandidates: HTMLElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLElement)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (node !== root && isSkippedElement(node, rules)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  if (isCandidateElement(root, rules)) {
    rawCandidates.push(root);
  }

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof HTMLElement && isCandidateElement(node, rules)) {
      rawCandidates.push(node);
    }
  }

  return rawCandidates.filter(
    (candidate) =>
      !rawCandidates.some(
        (other) => other !== candidate && candidate.contains(other),
      ),
  );
}

function ensurePageStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-open-translator-page="translation"] {
      box-sizing: border-box;
      margin-top: 0.28em;
      color: #2b5c9e;
      font: inherit;
      line-height: inherit;
    }

    [data-open-translator-page="translation"][data-display="inline"] {
      display: inline;
      margin-left: 0.35em;
    }

    [data-open-translator-page="translation"][data-display="block"] {
      display: block;
    }
  `;
  document.documentElement.append(style);
}

function ensureOverlay() {
  if (overlayHost?.isConnected) {
    return;
  }

  overlayHost = document.createElement('div');
  overlayHost.id = OVERLAY_HOST_ID;
  overlayHost.style.position = 'fixed';
  overlayHost.style.right = '16px';
  overlayHost.style.bottom = '16px';
  overlayHost.style.zIndex = '2147483647';
  overlayHost.style.pointerEvents = 'none';

  const shadow = overlayHost.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .panel {
        width: min(330px, calc(100vw - 32px));
        padding: 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        color: #f7f9fc;
        background: rgba(12, 18, 28, 0.94);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
        font-family: "Segoe UI", "Noto Sans KR", sans-serif;
        pointer-events: auto;
      }

      strong {
        display: block;
        margin-bottom: 4px;
        font-size: 14px;
      }

      p {
        margin: 0 0 10px;
        color: rgba(235, 241, 247, 0.78);
        font-size: 12px;
        line-height: 1.45;
      }

      progress {
        width: 100%;
        height: 8px;
        margin-bottom: 10px;
        accent-color: #ffbe55;
      }

      .actions {
        display: flex;
        gap: 8px;
      }

      button {
        flex: 1;
        min-height: 30px;
        border: 0;
        border-radius: 8px;
        padding: 6px 8px;
        color: #101722;
        background: #ffbe55;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }

      button.secondary {
        color: #eef4fb;
        background: rgba(255, 255, 255, 0.12);
      }

      button:disabled {
        cursor: default;
        opacity: 0.52;
      }
    </style>
    <section class="panel" aria-live="polite">
      <strong data-role="title">페이지 번역</strong>
      <p data-role="detail">준비 중...</p>
      <progress data-role="progress" max="1" value="0"></progress>
      <div class="actions">
        <button data-role="cancel" type="button">중지</button>
        <button class="secondary" data-role="restore" type="button">원문 복원</button>
      </div>
    </section>
  `;

  overlayTitle = shadow.querySelector('[data-role="title"]');
  overlayDetail = shadow.querySelector('[data-role="detail"]');
  overlayProgress = shadow.querySelector('[data-role="progress"]');
  overlayCancelButton = shadow.querySelector('[data-role="cancel"]');
  overlayRestoreButton = shadow.querySelector('[data-role="restore"]');

  overlayCancelButton?.addEventListener('click', () => {
    stopCurrentSession('페이지 번역 중지', '이미 바뀐 문장은 그대로 두었습니다.');
  });
  overlayRestoreButton?.addEventListener('click', () => {
    restoreOriginals();
  });

  document.documentElement.append(overlayHost);
}

function updateOverlay(
  title: string,
  detail: string,
  completed: number,
  total: number,
) {
  ensureOverlay();

  if (overlayTitle) overlayTitle.textContent = title;
  if (overlayDetail) overlayDetail.textContent = detail;
  if (overlayProgress) {
    overlayProgress.max = Math.max(1, total);
    overlayProgress.value = Math.min(completed, total);
  }
  if (overlayCancelButton) overlayCancelButton.disabled = !currentSession;
  if (overlayRestoreButton) {
    overlayRestoreButton.disabled = restoreRecords.size === 0;
  }
}

function updateSessionOverlay(session: TranslationSession) {
  updateOverlay(
    '페이지 번역 중',
    `${session.translatedCount}/${session.totalCount}개 문단 번역됨. 보이는 문단부터 처리합니다.`,
    session.completedCount,
    session.totalCount,
  );
}

function stopCurrentSession(title?: string, detail?: string) {
  if (!currentSession) {
    return;
  }

  const session = currentSession;
  session.cancelled = true;
  session.intersectionObserver.disconnect();
  session.mutationObserver.disconnect();
  if (session.scanTimer !== null) {
    window.clearTimeout(session.scanTimer);
  }
  currentSession = null;

  updateOverlay(
    title ?? '페이지 번역 중지',
    detail ?? '번역 작업을 멈췄습니다.',
    session.completedCount,
    Math.max(session.totalCount, 1),
  );
}

function restoreOriginals(showOverlay = true) {
  stopCurrentSession();

  for (const [element, record] of restoreRecords) {
    if (record.mode === 'replace') {
      if (element.isConnected) {
        element.replaceChildren(
          ...record.originalChildren.map((node) => node.cloneNode(true)),
        );
        element.removeAttribute('data-open-translator-page-unit');
      }
      continue;
    }

    record.wrapper.remove();
    record.unitElement.removeAttribute('data-open-translator-page-unit');
  }

  restoreRecords = new Map();

  if (showOverlay) {
    updateOverlay('원문 복원 완료', '번역된 문단을 원래 상태로 되돌렸습니다.', 1, 1);
  }
}

function serializeUnit(element: HTMLElement) {
  const placeholders = new Map<string, HTMLElement>();

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }

    if (!(node instanceof HTMLElement)) {
      return '';
    }

    const tagName = node.tagName.toUpperCase();
    if (tagName === 'BR') {
      return '\n';
    }

    if (closestSelector(node, BASE_SKIP_SELECTOR)) {
      return '';
    }

    const inner = Array.from(node.childNodes).map(serializeNode).join('');
    if (!INLINE_PLACEHOLDER_TAGS.has(tagName)) {
      return inner;
    }

    const placeholderName = `x${placeholders.size}`;
    placeholders.set(placeholderName, node.cloneNode(false) as HTMLElement);
    return `<${placeholderName}>${inner}</${placeholderName}>`;
  };

  const source = normalizeTextForRequest(
    Array.from(element.childNodes).map(serializeNode).join(''),
  );

  return { placeholders, source };
}

function createTranslationUnit(element: HTMLElement): TranslationUnit | null {
  const { placeholders, source } = serializeUnit(element);
  if (!source || !hasLanguageText(source) || isProbablyNonContent(source)) {
    return null;
  }

  return {
    element,
    id: nextTextId++,
    originalChildren: Array.from(element.childNodes).map((node) =>
      node.cloneNode(true),
    ),
    placeholders,
    source,
  };
}

function buildSafeTranslationFragment(unit: TranslationUnit, translation: string) {
  const template = document.createElement('template');
  template.innerHTML = translation;

  const buildNodes = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return [document.createTextNode(node.textContent ?? '')];
    }

    if (!(node instanceof HTMLElement)) {
      return [];
    }

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      return [document.createElement('br')];
    }

    const children = Array.from(node.childNodes).flatMap(buildNodes);
    const original = unit.placeholders.get(tagName);
    if (!original) {
      return children;
    }

    const clone = original.cloneNode(false) as HTMLElement;
    clone.replaceChildren(...children);
    return [clone];
  };

  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(template.content.childNodes).flatMap(buildNodes));

  if (fragment.childNodes.length === 0) {
    fragment.append(document.createTextNode(translation.trim()));
  }

  return fragment;
}

function shouldAppendBilingualInside(element: HTMLElement) {
  return ['DD', 'DT', 'LI', 'TD', 'TH'].includes(element.tagName.toUpperCase());
}

function isInlineDisplayElement(element: HTMLElement) {
  return window.getComputedStyle(element).display.startsWith('inline');
}

function applyTranslation(unit: TranslationUnit, translation: string, mode: PageTranslatorMode) {
  const cleanedTranslation = translation.trim();
  if (!cleanedTranslation || !unit.element.isConnected) {
    return false;
  }

  const fragment = buildSafeTranslationFragment(unit, cleanedTranslation);
  unit.element.setAttribute('data-open-translator-page-unit', 'true');

  if (mode === 'bilingual') {
    const wrapper = document.createElement(
      isInlineDisplayElement(unit.element) ? 'span' : 'div',
    );
    wrapper.dataset.openTranslatorPage = 'translation';
    wrapper.dataset.display = isInlineDisplayElement(unit.element)
      ? 'inline'
      : 'block';
    wrapper.append(fragment);

    if (shouldAppendBilingualInside(unit.element)) {
      unit.element.append(wrapper);
    } else {
      unit.element.after(wrapper);
    }

    restoreRecords.set(unit.element, {
      mode,
      unitElement: unit.element,
      wrapper,
    });
    return true;
  }

  restoreRecords.set(unit.element, {
    mode,
    originalChildren: unit.originalChildren,
    unitElement: unit.element,
  });
  unit.element.replaceChildren(fragment);
  return true;
}

function createBatch(session: TranslationSession) {
  const batch: TranslationUnit[] = [];
  let characterCount = 0;

  while (session.queue.length > 0 && batch.length < session.batchMaxItems) {
    const unit = session.queue[0];
    if (!unit) break;

    if (
      batch.length > 0 &&
      characterCount + unit.source.length > session.batchMaxCharacters
    ) {
      break;
    }

    session.queue.shift();
    batch.push(unit);
    characterCount += unit.source.length;
  }

  return batch;
}

async function requestBatchTranslation(batch: TranslationUnit[]) {
  const response = (await browser.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.translatePageTexts,
    payload: {
      items: batch.map((unit) => ({
        id: unit.id,
        text: unit.source,
      })),
      pageUrl: location.href,
    },
  })) as TranslatePageTextsResponse;

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return new Map(
    response.data.items.map((item) => [item.id, item.translation] as const),
  );
}

function drainQueue(session: TranslationSession) {
  if (session.cancelled || currentSession?.id !== session.id) {
    return;
  }

  while (session.activeBatchCount < session.maxConcurrentBatches) {
    const batch = createBatch(session);
    if (batch.length === 0) {
      return;
    }

    session.activeBatchCount += 1;

  void requestBatchTranslation(batch)
    .then((translationsById) => {
      if (session.cancelled || currentSession?.id !== session.id) {
        return;
      }

      for (const unit of batch) {
        const translation = translationsById.get(unit.id);
        if (translation && applyTranslation(unit, translation, session.mode)) {
          session.translatedCount += 1;
        }
        session.completedCount += 1;
      }

      updateSessionOverlay(session);
    })
    .catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : '페이지 번역 중 알 수 없는 오류가 발생했습니다.';
      updateOverlay('페이지 번역 실패', message, session.completedCount, session.totalCount);
    })
    .finally(() => {
      session.activeBatchCount = Math.max(0, session.activeBatchCount - 1);
      drainQueue(session);
    });
  }
}

function enqueueElement(session: TranslationSession, element: HTMLElement) {
  if (
    session.cancelled ||
    currentSession?.id !== session.id ||
    session.processedElements.has(element)
  ) {
    return;
  }

  session.processedElements.add(element);
  const unit = createTranslationUnit(element);
  if (!unit) {
    session.completedCount += 1;
    updateSessionOverlay(session);
    return;
  }

  session.queue.push(unit);
  drainQueue(session);
}

function observeCandidate(session: TranslationSession, element: HTMLElement) {
  if (
    session.cancelled ||
    session.observedElements.has(element) ||
    session.processedElements.has(element) ||
    restoreRecords.has(element)
  ) {
    return;
  }

  session.observedElements.add(element);
  session.totalCount += 1;
  session.intersectionObserver.observe(element);
}

function observeRoot(session: TranslationSession, root: HTMLElement) {
  for (const candidate of collectCandidateElements(root, session.rules)) {
    observeCandidate(session, candidate);
  }
}

function scheduleScan(session: TranslationSession, root: HTMLElement) {
  if (session.scanTimer !== null) {
    window.clearTimeout(session.scanTimer);
  }

  session.scanTimer = window.setTimeout(() => {
    session.scanTimer = null;
    if (!session.cancelled && currentSession?.id === session.id) {
      observeRoot(session, root);
      updateSessionOverlay(session);
    }
  }, MUTATION_SCAN_DELAY_MS);
}

function createMutationObserver(session: TranslationSession) {
  return new MutationObserver((records) => {
    for (const record of records) {
      const target =
        record.target instanceof HTMLElement
          ? record.target
          : record.target.parentElement;
      if (!target || closestSelector(target, `[data-open-translator-page="translation"]`)) {
        continue;
      }

      if (record.type === 'childList') {
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof HTMLElement && !isSkippedElement(node, session.rules)) {
            scheduleScan(session, node);
          } else if (node.nodeType === Node.TEXT_NODE && target instanceof HTMLElement) {
            scheduleScan(session, target);
          }
        }
        continue;
      }

      if (
        record.type === 'characterData' ||
        (record.type === 'attributes' &&
          ['style', 'class', 'hidden', 'aria-hidden'].includes(
            record.attributeName ?? '',
          ))
      ) {
        scheduleScan(session, target);
      }
    }
  });
}

async function translatePage(
  override?: PageTranslatorContentMessage & {
    type: typeof PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES.translatePage;
  },
): Promise<PageTranslatorContentResponse> {
  restoreOriginals(false);
  ensurePageStyles();

  const savedSettings = await loadPageTranslatorSettings();
  const mode = override?.payload?.mode ?? savedSettings.mode;
  const turboMode =
    override?.payload?.turboMode ?? savedSettings.turboMode ?? false;
  const siteRule =
    override?.payload?.siteRule ??
    savedSettings.siteRules[location.hostname.toLowerCase()];
  const rules = normalizeRules(siteRule);
  const performance = getPerformanceConfig(turboMode);

  const sessionId = nextSessionId++;
  const session: TranslationSession = {
    activeBatchCount: 0,
    batchMaxCharacters: performance.batchMaxCharacters,
    batchMaxItems: performance.batchMaxItems,
    cancelled: false,
    completedCount: 0,
    id: sessionId,
    intersectionObserver: new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) {
            continue;
          }
          observer.unobserve(entry.target);
          enqueueElement(session, entry.target);
        }
      },
      {
        root: null,
        rootMargin: performance.rootMargin,
        threshold: 0.01,
      },
    ),
    maxConcurrentBatches: performance.maxConcurrentBatches,
    mode,
    mutationObserver: new MutationObserver(() => undefined),
    observedElements: new WeakSet(),
    processedElements: new WeakSet(),
    queue: [],
    rules,
    scanTimer: null,
    totalCount: 0,
    translatedCount: 0,
    turboMode,
  };
  session.mutationObserver = createMutationObserver(session);
  currentSession = session;

  const roots = getScanRoots(rules);
  for (const root of roots) {
    observeRoot(session, root);
  }

  if (document.body) {
    session.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  updateOverlay(
    '페이지 번역 시작',
    `${session.totalCount}개 후보 문단을 찾았습니다. 화면에 가까운 문단부터 번역합니다.`,
    0,
    Math.max(session.totalCount, 1),
  );

  return {
    ok: true,
    totalCount: session.totalCount,
    translatedCount: 0,
  };
}

async function handleContentMessage(
  message: PageTranslatorContentMessage,
): Promise<PageTranslatorContentResponse> {
  if (message.type === PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES.translatePage) {
    return translatePage(message);
  }

  if (message.type === PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES.cancelTranslation) {
    stopCurrentSession();
    return { ok: true };
  }

  restoreOriginals();
  return { ok: true };
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isPageTranslatorMessage(message)) {
        return false;
      }

      void handleContentMessage(message).then(sendResponse);
      return true;
    });
  },
});
