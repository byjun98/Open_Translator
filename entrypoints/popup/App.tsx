import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES,
  type PageTranslatorContentResponse,
} from '../../lib/messages';
import {
  defaultPageTranslatorSettings,
  getPageTranslatorHostKey,
  loadPageTranslatorSettings,
  savePageTranslatorSettings,
  savePageTranslatorSiteRule,
  type PageTranslatorMode,
  type PageTranslatorSiteRule,
} from '../../lib/page-translator-settings';
import {
  fetchProxyModels,
  type ProxyModelsResult,
} from '../../lib/proxy-models';
import {
  defaults,
  loadSettings,
  saveSettings,
  type ExtensionSettings,
} from '../../lib/settings';

function formatProxyLocation(baseUrl: string | undefined) {
  if (!baseUrl) return 'localhost';
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}:${url.port || '443'}`;
  } catch {
    return baseUrl;
  }
}

function formatProxyStatus(result: ProxyModelsResult) {
  if (result.source === 'proxy') {
    return `프록시 연결됨 (${formatProxyLocation(result.baseUrl)}). 모델 ${result.models.length}개`;
  }

  return `프록시 확인 필요. 기본 모델 ${result.models.length}개만 표시 중`;
}

function formatPageTranslatorError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : '페이지 번역을 시작하지 못했습니다.';

  if (/could not establish connection|receiving end does not exist/i.test(message)) {
    return '이 페이지에서는 전체 번역을 사용할 수 없습니다. 일반 웹페이지에서 다시 시도하세요.';
  }

  return message;
}

const emptySiteRule: PageTranslatorSiteRule = {
  includeSelectors: '',
  skipSelectors: '',
};

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaults);
  const [modelOptions, setModelOptions] = useState<string[]>([defaults.model]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPageTranslating, setIsPageTranslating] = useState(false);
  const [pageMode, setPageMode] = useState<PageTranslatorMode>(
    defaultPageTranslatorSettings.mode,
  );
  const [pageTurboMode, setPageTurboMode] = useState(
    defaultPageTranslatorSettings.turboMode,
  );
  const [siteRule, setSiteRule] = useState<PageTranslatorSiteRule>(emptySiteRule);
  const [activeHost, setActiveHost] = useState('');
  const [status, setStatus] = useState('빠른 설정을 불러오는 중...');
  const [pageStatus, setPageStatus] = useState('');

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      const [next, proxy, pageSettings] = await Promise.all([
        loadSettings(),
        fetchProxyModels(),
        loadPageTranslatorSettings(),
      ]);
      if (!mounted) {
        return;
      }

      setSettings(next);
      setModelOptions(Array.from(new Set([next.model, ...proxy.models])));
      setStatus(formatProxyStatus(proxy));
      setPageMode(pageSettings.mode);
      setPageTurboMode(pageSettings.turboMode);

      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const host = activeTab?.url ? getPageTranslatorHostKey(activeTab.url) : '';
        if (!mounted) {
          return;
        }
        setActiveHost(host);
        setSiteRule(host ? pageSettings.siteRules[host] ?? emptySiteRule : emptySiteRule);
      } catch {
        if (mounted) {
          setActiveHost('');
          setSiteRule(emptySiteRule);
        }
      }
    }

    void hydrate();

    return () => {
      mounted = false;
    };
  }, []);

  async function patchSettings(next: Partial<ExtensionSettings>) {
    setIsSaving(true);

    try {
      const saved = await saveSettings(next);
      setSettings(saved);
      setStatus('저장되었습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '설정 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function getActiveTabId() {
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (typeof activeTab?.id !== 'number') {
      throw new Error('활성 탭을 찾지 못했습니다.');
    }

    return activeTab.id;
  }

  async function persistPageSettings(
    mode = pageMode,
    rule = siteRule,
    turboMode = pageTurboMode,
  ) {
    await savePageTranslatorSettings({ mode, turboMode });
    if (activeHost) {
      await savePageTranslatorSiteRule(activeHost, rule);
    }
  }

  async function sendPageTranslatorMessage(
    type: (typeof PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES)[keyof typeof PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES],
    payload?: {
      mode?: PageTranslatorMode;
      siteRule?: PageTranslatorSiteRule;
      turboMode?: boolean;
    },
  ) {
    const tabId = await getActiveTabId();
    return browser.tabs.sendMessage(tabId, {
      type,
      payload,
    }) as Promise<PageTranslatorContentResponse>;
  }

  async function handleTranslatePage() {
    if (isPageTranslating) {
      return;
    }

    setIsPageTranslating(true);
    setPageStatus('페이지 번역을 시작하는 중입니다...');

    try {
      await persistPageSettings();
      const response = await sendPageTranslatorMessage(
        PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES.translatePage,
        {
          mode: pageMode,
          siteRule,
          turboMode: pageTurboMode,
        },
      );
      if (!response.ok) {
        throw new Error(response.message);
      }

      setPageStatus(
        `lazy 번역 시작: 후보 문단 ${response.totalCount ?? 0}개. ${
          pageTurboMode ? '터보 병렬로' : '보이는 문단부터'
        } 번역합니다.`,
      );
    } catch (error) {
      setPageStatus(formatPageTranslatorError(error));
    } finally {
      setIsPageTranslating(false);
    }
  }

  async function handleRestorePage() {
    try {
      const response = await sendPageTranslatorMessage(
        PAGE_TRANSLATOR_CONTENT_MESSAGE_TYPES.restorePage,
      );
      if (!response.ok) {
        throw new Error(response.message);
      }

      setPageStatus('현재 페이지를 원문으로 복원했습니다.');
    } catch (error) {
      setPageStatus(formatPageTranslatorError(error));
    }
  }

  async function handleSavePageRules() {
    try {
      await persistPageSettings();
      setPageStatus(
        activeHost
          ? `${activeHost} 규칙을 저장했습니다.`
          : '현재 탭의 사이트 주소를 읽지 못해 공통 모드만 저장했습니다.',
      );
    } catch (error) {
      setPageStatus(error instanceof Error ? error.message : '페이지 번역 설정 저장에 실패했습니다.');
    }
  }

  return (
    <main className="popup-shell">
      <section className="popup-card">
        <header className="popup-header">
          <div>
            <p className="popup-eyebrow">Quick Settings</p>
            <h1>Open Translator</h1>
          </div>
          <label className="toggle-chip">
            <input
              checked={settings.enabled}
              onChange={(event) => {
                void patchSettings({ enabled: event.currentTarget.checked });
              }}
              type="checkbox"
            />
            <span>{settings.enabled ? '켜짐' : '꺼짐'}</span>
          </label>
        </header>

        <p className="popup-status">{status}</p>

        <div className="popup-actions">
          <button
            className="popup-button"
            disabled={isPageTranslating}
            type="button"
            onClick={() => void handleTranslatePage()}>
            {isPageTranslating ? '시작 중...' : '현재 페이지 번역'}
          </button>
          <button
            className="popup-button popup-button--secondary"
            disabled={isPageTranslating}
            type="button"
            onClick={() => void handleRestorePage()}>
            원문 복원
          </button>
        </div>

        <label className="popup-field">
          <span>페이지 번역 모드</span>
          <select
            value={pageMode}
            onChange={(event) => {
              const nextMode = event.currentTarget.value as PageTranslatorMode;
              setPageMode(nextMode);
              void savePageTranslatorSettings({ mode: nextMode });
            }}>
            <option value="replace">원문 교체</option>
            <option value="bilingual">원문 + 번역</option>
          </select>
        </label>

        <label className="popup-check">
          <input
            checked={pageTurboMode}
            onChange={(event) => {
              const nextTurboMode = event.currentTarget.checked;
              setPageTurboMode(nextTurboMode);
              void savePageTranslatorSettings({ turboMode: nextTurboMode });
            }}
            type="checkbox"
          />
          <span>터보 모드: 더 큰 묶음으로 병렬 번역</span>
        </label>

        <div className="popup-rule-box">
          <strong>{activeHost || '현재 사이트'}</strong>
          <label className="popup-field">
            <span>Include selector</span>
            <textarea
              value={siteRule.includeSelectors}
              onChange={(event) =>
                setSiteRule((current) => ({
                  ...current,
                  includeSelectors: event.currentTarget.value,
                }))
              }
              placeholder={'비워두면 전체 페이지\n예: article\n예: main .content'}
            />
          </label>
          <label className="popup-field">
            <span>Skip selector</span>
            <textarea
              value={siteRule.skipSelectors}
              onChange={(event) =>
                setSiteRule((current) => ({
                  ...current,
                  skipSelectors: event.currentTarget.value,
                }))
              }
              placeholder={'예: nav\n예: .ad, .comments'}
            />
          </label>
          <button
            className="popup-button popup-button--secondary"
            type="button"
            onClick={() => void handleSavePageRules()}>
            페이지 규칙 저장
          </button>
        </div>

        {pageStatus ? <p className="popup-status">{pageStatus}</p> : null}

        <label className="popup-field">
          <span>모델</span>
          <select
            value={settings.model}
            onChange={(event) => {
              void patchSettings({ model: event.currentTarget.value });
            }}>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        <label className="popup-field">
          <span>번역 언어</span>
          <input
            type="text"
            value={settings.targetLanguage}
            onChange={(event) => {
              setSettings((current) => ({
                ...current,
                targetLanguage: event.currentTarget.value,
              }));
            }}
            onBlur={(event) => {
              void patchSettings({ targetLanguage: event.currentTarget.value });
            }}
            placeholder="Korean"
          />
        </label>

        <label className="popup-check">
          <input
            checked={settings.showSourceCaption}
            onChange={(event) => {
              void patchSettings({ showSourceCaption: event.currentTarget.checked });
            }}
            type="checkbox"
          />
          <span>원문 자막 함께 보기</span>
        </label>

        <label className="popup-check">
          <input
            checked={settings.overlayPosition === 'top'}
            onChange={(event) => {
              void patchSettings({
                overlayPosition: event.currentTarget.checked ? 'top' : 'bottom',
              });
            }}
            type="checkbox"
          />
          <span>자막 오버레이를 상단에 표시</span>
        </label>

        <button
          className="popup-button"
          disabled={isSaving}
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}>
          전체 설정 열기
        </button>
      </section>
    </main>
  );
}

export default App;
