import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { fetchProxyModels } from '../../lib/proxy-models';
import {
  defaults,
  loadSettings,
  resetSettings,
  saveSettings,
  type ExtensionSettings,
  type OverlayPosition,
} from '../../lib/settings';

const languageOptions = [
  { value: 'Korean', label: '한국어' },
  { value: 'English', label: '영어' },
  { value: 'Japanese', label: '일본어' },
  { value: 'Spanish', label: '스페인어' },
  { value: 'French', label: '프랑스어' },
  { value: 'German', label: '독일어' },
  { value: 'Chinese (Simplified)', label: '중국어 간체' },
];

const settingKeys = Object.keys(defaults) as (keyof ExtensionSettings)[];

type NumberSettingKey =
  | 'requestTimeoutMs'
  | 'debounceMs'
  | 'maxCharactersPerRequest';

interface FieldProps {
  label: string;
  hint: string;
  htmlFor?: string;
  full?: boolean;
  children: ReactNode;
}

interface ToggleFieldProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Field({ label, hint, htmlFor, full = false, children }: FieldProps) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <div className="field-copy">
        {htmlFor ? (
          <label className="field-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="field-label">{label}</span>
        )}
        <p className="field-hint">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function ToggleField({ label, hint, checked, onChange }: ToggleFieldProps) {
  return (
    <label className="toggle-card">
      <div className="toggle-copy">
        <span className="field-label">{label}</span>
        <p className="field-hint">{hint}</p>
      </div>
      <span className="switch">
        <input
          checked={checked}
          className="switch-input"
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" className="switch-ui" />
      </span>
    </label>
  );
}

function getOptionLabel(
  options: Array<{ value: string; label: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function formatError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<ExtensionSettings | null>(
    null,
  );
  const [modelOptions, setModelOptions] = useState<string[]>([defaults.model]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [loaded, models] = await Promise.all([
          loadSettings(),
          fetchProxyModels(),
        ]);
        if (cancelled) {
          return;
        }

        setSettings(loaded);
        setSavedSettings(loaded);
        setModelOptions(Array.from(new Set([loaded.model, ...models])));
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        const fallback = { ...defaults };
        setSettings(fallback);
        setSavedSettings(fallback);
        setError(
          formatError(loadError, '설정을 불러오지 못했습니다. 기본값으로 표시합니다.'),
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const changedKeys =
    settings && savedSettings
      ? settingKeys.filter((key) => settings[key] !== savedSettings[key])
      : [];
  const hasChanges = changedKeys.length > 0;
  const languageLabel = getOptionLabel(
    languageOptions,
    settings?.targetLanguage ?? defaults.targetLanguage,
  );

  function updateSetting<K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
    setMessage(null);
    setError(null);
  }

  function updateNumberSetting(key: NumberSettingKey, rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    updateSetting(
      key,
      (Number.isFinite(parsed) ? parsed : 0) as ExtensionSettings[NumberSettingKey],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!settings || !hasChanges || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const persisted = await saveSettings(settings);
      setSettings(persisted);
      setSavedSettings(persisted);
      setMessage(`${formatClock(new Date())}에 설정을 저장했습니다.`);
    } catch (saveError) {
      setError(formatError(saveError, '설정을 저장하지 못했습니다.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (isSaving) {
      return;
    }

    const confirmed = window.confirm('모든 자막 번역 설정을 기본값으로 되돌릴까요?');
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const restored = await resetSettings();
      setSettings(restored);
      setSavedSettings(restored);
      setMessage('기본 설정으로 되돌렸습니다.');
    } catch (resetError) {
      setError(formatError(resetError, '기본값으로 초기화하지 못했습니다.'));
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    if (!savedSettings || isSaving) {
      return;
    }

    setSettings({ ...savedSettings });
    setMessage(null);
    setError(null);
  }

  function renderPreviewContent(position: OverlayPosition) {
    if (!settings?.enabled) {
      return <div className="preview-badge">번역 일시정지</div>;
    }

    return (
      <>
        <div className={`preview-overlay preview-overlay--${position}`}>
          <div className="preview-caption preview-caption--translated">
            {languageLabel} 번역 자막
          </div>
          {settings.showSourceCaption ? (
            <div className="preview-caption preview-caption--source">
              원문 자막
            </div>
          ) : null}
        </div>
        <div className="preview-meta">
          {position === 'top'
            ? '플레이어 상단에 고정'
            : '플레이어 하단에 이중 자막 형태로 표시'}
        </div>
      </>
    );
  }

  if (isLoading || !settings) {
    return (
      <div className="options-shell">
        <main className="options-page options-page--loading">
          <section className="card loading-card">
            <p className="eyebrow">설정</p>
            <h1>자막 번역 설정을 불러오는 중...</h1>
            <p className="hero-text">
              저장된 모델, 프롬프트, 표시 옵션을 읽고 있습니다.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="options-shell">
      <main className="options-page">
        <header className="card hero">
          <div className="hero-copy">
            <p className="eyebrow">로컬 전용 유튜브 자막 번역기</p>
            <h1>유튜브 자막이 지나가기 전에 읽기 좋은 속도로 맞추세요.</h1>
            <p className="hero-text">
              모델, 프롬프트, 디바운스, 자막 표시 위치를 조절해서 자동 생성
              자막도 더 자연스럽게 볼 수 있습니다. 설정은{' '}
              <code>browser.storage.sync</code>에 저장됩니다.
            </p>
          </div>
          <div className="hero-panel">
            <div className="status-row">
              <span
                className={`status-pill ${
                  settings.enabled
                    ? 'status-pill--enabled'
                    : 'status-pill--disabled'
                }`}>
                {settings.enabled ? '번역 켜짐' : '번역 꺼짐'}
              </span>
              <span className="status-pill status-pill--muted">동기화 저장소</span>
            </div>
            <div className="hero-metrics">
              <div className="metric-card">
                <span className="metric-label">대상 언어</span>
                <strong>{languageLabel}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">모델</span>
                <strong>{settings.model}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">오버레이</span>
                <strong>{settings.overlayPosition === 'top' ? '상단' : '하단'}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">글자 수 제한</span>
                <strong>{settings.maxCharactersPerRequest}</strong>
              </div>
            </div>
          </div>
        </header>

        {error ? <div className="banner banner--error">{error}</div> : null}
        {message ? <div className="banner banner--success">{message}</div> : null}

        <form className="options-layout" onSubmit={handleSubmit}>
          <div className="settings-stack">
            <section className="card section-card">
              <div className="section-head">
                <h2>번역 기본 동작</h2>
                <p>
                  번역을 켜고 끄거나, 어느 언어로 번역할지, 어떤 프롬프트를 쓸지
                  정합니다.
                </p>
              </div>
              <div className="section-body">
                <div className="field field--full">
                  <ToggleField
                    checked={settings.enabled}
                    hint="확장을 삭제하지 않고 번역만 잠시 끄고 싶을 때 사용합니다."
                    label="자막 번역 사용"
                    onChange={(checked) => updateSetting('enabled', checked)}
                  />
                </div>

                <Field
                  full
                  hint="예: Korean, English, Japanese, Spanish"
                  htmlFor="target-language"
                  label="번역 대상 언어">
                  <input
                    className="control"
                    id="target-language"
                    list="target-language-options"
                    onChange={(event) =>
                      updateSetting('targetLanguage', event.currentTarget.value)
                    }
                    placeholder="Korean"
                    spellCheck={false}
                    type="text"
                    value={settings.targetLanguage}
                  />
                  <datalist id="target-language-options">
                    {languageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </Field>

                <Field
                  full
                  hint="아래 치환자를 조합해서 번역 스타일을 세밀하게 바꿀 수 있습니다."
                  htmlFor="prompt-template"
                  label="프롬프트">
                  <textarea
                    className="control control--textarea"
                    id="prompt-template"
                    onChange={(event) =>
                      updateSetting('promptTemplate', event.currentTarget.value)
                    }
                    spellCheck={false}
                    value={settings.promptTemplate}
                  />
                  <div className="token-row">
                    <span className="token">{'{{targetLanguage}}'}</span>
                    <span className="token">{'{{sourceLanguage}}'}</span>
                    <span className="token">{'{{pageUrl}}'}</span>
                    <span className="token">{'{{text}}'}</span>
                  </div>
                </Field>
              </div>
            </section>

            <section className="card section-card">
              <div className="section-head">
                <h2>모델과 응답 속도</h2>
                <p>
                  로컬 프록시가 지원하는 모델을 선택하고, 번역 요청 속도를
                  맞춥니다.
                </p>
              </div>
              <div className="section-body">
                <Field
                  full
                  hint={`현재 로컬 프록시에서 확인된 모델 ${modelOptions.length}개 중 하나를 선택하세요.`}
                  htmlFor="model"
                  label="모델">
                  <select
                    className="control"
                    id="model"
                    onChange={(event) =>
                      updateSetting('model', event.currentTarget.value)
                    }
                    value={settings.model}>
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  hint="응답이 너무 느릴 때 요청을 끊는 시간입니다."
                  htmlFor="request-timeout"
                  label="요청 타임아웃">
                  <div className="control-shell">
                    <input
                      className="control"
                      id="request-timeout"
                      min={1000}
                      onChange={(event) =>
                        updateNumberSetting(
                          'requestTimeoutMs',
                          event.currentTarget.value,
                        )
                      }
                      step={250}
                      type="number"
                      value={settings.requestTimeoutMs}
                    />
                    <span className="control-unit">ms</span>
                  </div>
                </Field>

                <Field
                  hint="값이 작으면 더 빠르고, 크면 덜 흔들리지만 늦게 번역됩니다."
                  htmlFor="debounce"
                  label="디바운스">
                  <div className="control-shell">
                    <input
                      className="control"
                      id="debounce"
                      min={180}
                      onChange={(event) =>
                        updateNumberSetting('debounceMs', event.currentTarget.value)
                      }
                      step={25}
                      type="number"
                      value={settings.debounceMs}
                    />
                    <span className="control-unit">ms</span>
                  </div>
                </Field>

                <Field
                  hint="한 번에 보내는 자막 길이를 제한해서 번역 지연을 줄입니다."
                  htmlFor="max-characters"
                  label="최대 글자 수">
                  <div className="control-shell">
                    <input
                      className="control"
                      id="max-characters"
                      min={40}
                      onChange={(event) =>
                        updateNumberSetting(
                          'maxCharactersPerRequest',
                          event.currentTarget.value,
                        )
                      }
                      step={10}
                      type="number"
                      value={settings.maxCharactersPerRequest}
                    />
                    <span className="control-unit">자</span>
                  </div>
                </Field>
              </div>
            </section>

            <section className="card section-card">
              <div className="section-head">
                <h2>화면 표시 방식</h2>
                <p>
                  번역 자막을 어느 위치에 띄울지, 원문도 함께 보여줄지 정합니다.
                </p>
              </div>
              <div className="section-body">
                <div className="field field--full">
                  <ToggleField
                    checked={settings.showSourceCaption}
                    hint="번역문 아래에 원문 자막을 함께 표시합니다."
                    label="원문 자막 함께 보기"
                    onChange={(checked) =>
                      updateSetting('showSourceCaption', checked)
                    }
                  />
                </div>

                <Field
                  full
                  hint="상단은 영상 중심부를 덜 가리고, 하단은 기본 자막에 더 가깝습니다."
                  label="오버레이 위치">
                  <div
                    aria-label="오버레이 위치"
                    className="segment-control"
                    role="radiogroup">
                    {(['bottom', 'top'] as OverlayPosition[]).map((option) => (
                      <label
                        className={`segment-option ${
                          settings.overlayPosition === option
                            ? 'segment-option--active'
                            : ''
                        }`}
                        key={option}>
                        <input
                          checked={settings.overlayPosition === option}
                          className="segment-input"
                          name="overlay-position"
                          onChange={() => updateSetting('overlayPosition', option)}
                          type="radio"
                          value={option}
                        />
                        <span>{option === 'bottom' ? '하단' : '상단'}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </section>
          </div>

          <aside className="side-stack">
            <section className="card preview-card">
              <div className="section-head">
                <h2>미리보기</h2>
                <p>현재 설정으로 자막이 어떤 식으로 보일지 빠르게 확인합니다.</p>
              </div>

              <div className="preview-player">
                <div className="preview-chrome">
                  <span className="preview-dot" />
                  <span className="preview-dot" />
                  <span className="preview-dot" />
                </div>
                <div className="preview-stage">
                  {renderPreviewContent(settings.overlayPosition)}
                </div>
              </div>

              <div className="summary-list">
                <div className="summary-row">
                  <span>원문 표시</span>
                  <strong>{settings.showSourceCaption ? '보임' : '숨김'}</strong>
                </div>
                <div className="summary-row">
                  <span>요청 시간 제한</span>
                  <strong>{settings.requestTimeoutMs} ms</strong>
                </div>
                <div className="summary-row">
                  <span>디바운스</span>
                  <strong>{settings.debounceMs} ms</strong>
                </div>
                <div className="summary-row">
                  <span>글자 수 제한</span>
                  <strong>{settings.maxCharactersPerRequest} 자</strong>
                </div>
              </div>
            </section>

            <section className="card action-card">
              <div className="section-head">
                <h2>저장 상태</h2>
                <p>
                  {hasChanges
                    ? `마지막 저장 이후 ${changedKeys.length}개 항목이 변경되었습니다.`
                    : '현재 화면의 설정이 저장된 값과 같습니다.'}
                </p>
              </div>

              <div className="action-stack">
                <button
                  className="button button--primary"
                  disabled={!hasChanges || isSaving}
                  type="submit">
                  {isSaving ? '저장 중...' : '설정 저장'}
                </button>
                <button
                  className="button button--secondary"
                  disabled={!hasChanges || isSaving}
                  onClick={handleDiscard}
                  type="button">
                  변경 취소
                </button>
                <button
                  className="button button--ghost"
                  disabled={isSaving}
                  onClick={handleReset}
                  type="button">
                  기본값으로 초기화
                </button>
              </div>

              <div className="storage-note">
                <strong>동기화 저장소에 저장됩니다.</strong>
                <span>
                  모델, 프롬프트, 토글 설정 같은 작은 환경설정을 저장하기에
                  적합합니다.
                </span>
              </div>
            </section>
          </aside>
        </form>
      </main>
    </div>
  );
}

export default App;
