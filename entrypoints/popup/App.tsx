import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { fetchProxyModels } from '../../lib/proxy-models';
import {
  defaults,
  loadSettings,
  saveSettings,
  type ExtensionSettings,
} from '../../lib/settings';

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaults);
  const [modelOptions, setModelOptions] = useState<string[]>([defaults.model]);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('빠른 설정을 불러오는 중...');

  useEffect(() => {
    let mounted = true;

    Promise.all([loadSettings(), fetchProxyModels()]).then(([next, models]) => {
      if (!mounted) {
        return;
      }

      setSettings(next);
      setModelOptions(Array.from(new Set([next.model, ...models])));
      setStatus(`현재 설정을 바로 바꿀 수 있습니다. 사용 가능한 모델 ${models.length}개`);
    });

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

  return (
    <main className="popup-shell">
      <section className="popup-card">
        <header className="popup-header">
          <div>
            <p className="popup-eyebrow">빠른 설정</p>
            <h1>자막 번역</h1>
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
          <span>상단에 자막 띄우기</span>
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
