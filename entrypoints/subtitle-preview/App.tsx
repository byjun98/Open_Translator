import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  BACKGROUND_MESSAGE_TYPES,
  type PolishSubtitleCuesResponse,
} from '../../lib/messages';
import {
  SUBTITLE_EXPORT_STORAGE_PREFIX,
  buildSrt,
  formatSrtTimestamp,
  sanitizeFilename,
  type SubtitleExportCue,
  type SubtitleExportMode,
  type SubtitleExportPayload,
} from '../../lib/subtitle-export';

type EditableField = 'source' | 'translation';
const POLISH_CHUNK_SIZE = 50;

function getInitialMode(): SubtitleExportMode {
  const mode = new URLSearchParams(location.search).get('mode');
  return mode === 'bilingual' ? 'bilingual' : 'translated';
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([`\ufeff${text}`], {
    type: 'application/x-subrip;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatModeLabel(mode: SubtitleExportMode) {
  return mode === 'translated' ? '번역' : '원문+번역';
}

function formatTimelineTime(seconds: number) {
  return formatSrtTimestamp(seconds).replace(',', '.');
}

function App() {
  const [payload, setPayload] = useState<SubtitleExportPayload | null>(null);
  const [editableCues, setEditableCues] = useState<SubtitleExportCue[]>([]);
  const [mode, setMode] = useState<SubtitleExportMode>(getInitialMode);
  const [error, setError] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStatus, setPolishStatus] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      setError('확인할 자막 데이터가 없습니다.');
      return;
    }

    const key = `${SUBTITLE_EXPORT_STORAGE_PREFIX}${id}`;
    browser.storage.local
      .get(key)
      .then((stored) => {
        const nextPayload = stored[key] as SubtitleExportPayload | undefined;
        if (!nextPayload?.cues?.length) {
          setError('자막 데이터를 찾지 못했어요. YouTube 탭에서 다시 내보내주세요.');
          return;
        }
        setPayload(nextPayload);
        setEditableCues(nextPayload.cues);
        setMode(nextPayload.recommendedMode ?? getInitialMode());
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : '자막 데이터를 불러오지 못했어요.',
        );
      });
  }, []);

  const srt = useMemo(
    () => buildSrt(editableCues, mode),
    [editableCues, mode],
  );

  const filename = payload
    ? `${sanitizeFilename(payload.title)}.${formatModeLabel(mode)}.srt`
    : 'youtube-subtitles.srt';
  const editedCount = payload
    ? editableCues.filter((cue, index) => {
        const original = payload.cues[index];
        return (
          original &&
          (cue.source !== original.source ||
            cue.translation !== original.translation)
        );
      }).length
    : 0;

  function updateCue(index: number, field: EditableField, value: string) {
    setEditableCues((current) =>
      current.map((cue, cueIndex) =>
        cueIndex === index ? { ...cue, [field]: value } : cue,
      ),
    );
  }

  function resetCue(index: number) {
    if (!payload) return;
    const original = payload.cues[index];
    if (!original) return;

    setEditableCues((current) =>
      current.map((cue, cueIndex) => (cueIndex === index ? original : cue)),
    );
  }

  function resetAll() {
    if (payload) {
      setEditableCues(payload.cues);
      setPolishStatus('');
    }
  }

  async function polishWithContext() {
    if (!payload || editableCues.length === 0 || isPolishing) return;

    setIsPolishing(true);
    setPolishStatus('문맥 다듬기 준비 중...');

    try {
      const nextCues = editableCues.map((cue) => ({ ...cue }));
      const chunks: SubtitleExportCue[][] = [];
      for (let i = 0; i < editableCues.length; i += POLISH_CHUNK_SIZE) {
        chunks.push(editableCues.slice(i, i + POLISH_CHUNK_SIZE));
      }

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const offset = chunkIndex * POLISH_CHUNK_SIZE;
        setPolishStatus(
          `문맥 다듬기 ${chunkIndex + 1}/${chunks.length} 구간 처리 중...`,
        );

        const response = (await browser.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.polishSubtitleCues,
          payload: {
            title: payload.title,
            pageUrl: payload.pageUrl,
            sourceLanguageHint: payload.sourceLanguageHint,
            targetLanguage: payload.targetLanguage,
            cues: chunk.map((cue, index) => ({
              index: offset + index,
              start: cue.start,
              end: cue.end,
              source: cue.source,
              translation: cue.translation,
            })),
          },
        })) as PolishSubtitleCuesResponse;

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        for (const polishedCue of response.data.cues) {
          const current = nextCues[polishedCue.index];
          if (!current) continue;
          nextCues[polishedCue.index] = {
            ...current,
            translation: polishedCue.translation || current.translation,
          };
        }

        setEditableCues(nextCues.map((cue) => ({ ...cue })));
      }

      setPolishStatus('문맥 다듬기가 완료됐어요. 표에서 다시 확인해보세요.');
    } catch (polishError) {
      setPolishStatus(
        polishError instanceof Error
          ? `문맥 다듬기 실패: ${polishError.message}`
          : '문맥 다듬기에 실패했어요.',
      );
    } finally {
      setIsPolishing(false);
    }
  }

  if (error) {
    return (
      <main className="preview-shell preview-shell--center">
        <section className="panel">
          <p className="eyebrow">SRT 확인</p>
          <h1>자막을 불러오지 못했어요</h1>
          <p className="muted">{error}</p>
        </section>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="preview-shell preview-shell--center">
        <section className="panel">
          <p className="eyebrow">SRT 확인</p>
          <h1>자막을 여는 중...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="preview-shell">
      <header className="preview-header">
        <div>
          <p className="eyebrow">SRT 확인</p>
          <h1>{payload.title}</h1>
          <p className="muted">
            {editableCues.length.toLocaleString()}개 자막 · {payload.targetLanguage}
            {editedCount > 0 ? ` · 수정 ${editedCount.toLocaleString()}개` : ''}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button secondary-button--accent"
            disabled={isPolishing}
            onClick={() => void polishWithContext()}
            type="button">
            전체 문맥으로 다듬기
          </button>
          <button
            className="secondary-button"
            disabled={editedCount === 0 || isPolishing}
            onClick={resetAll}
            type="button">
            전체 되돌리기
          </button>
          <button
            className="download-button"
            disabled={isPolishing}
            onClick={() => downloadText(filename, srt)}
            type="button">
            .srt 다운로드
          </button>
        </div>
      </header>

      <section className="panel panel--controls">
        <div className="mode-row" role="radiogroup" aria-label="자막 형식">
          {(['translated', 'bilingual'] as SubtitleExportMode[]).map((option) => (
            <label
              className={`mode-option ${mode === option ? 'mode-option--active' : ''}`}
              key={option}>
              <input
                checked={mode === option}
                name="subtitle-mode"
                onChange={() => setMode(option)}
                type="radio"
              />
              <span>{formatModeLabel(option)}</span>
            </label>
          ))}
        </div>
        <p className="control-note">
          아래 표에서 원문과 번역을 직접 수정하면 다운로드되는 SRT에 바로 반영됩니다.
          {polishStatus ? ` ${polishStatus}` : ''}
        </p>
      </section>

      <section className="panel timeline-panel">
        <div className="timeline-head" aria-hidden="true">
          <span>#</span>
          <span>시간</span>
          <span>원문</span>
          <span>번역</span>
          <span />
        </div>

        <div className="timeline-list">
          {editableCues.map((cue, index) => {
            const original = payload.cues[index];
            const isEdited =
              Boolean(original) &&
              (cue.source !== original?.source ||
                cue.translation !== original?.translation);

            return (
              <article
                className={`cue-row ${isEdited ? 'cue-row--edited' : ''}`}
                key={`${cue.start}-${cue.end}-${index}`}>
                <div className="cue-index">{index + 1}</div>
                <div className="cue-time">
                  <span>{formatTimelineTime(cue.start)}</span>
                  <span>{formatTimelineTime(cue.end)}</span>
                </div>
                <label className="cue-field">
                  <span>원문</span>
                  <textarea
                    aria-label={`${index + 1}번 원문`}
                    onChange={(event) =>
                      updateCue(index, 'source', event.currentTarget.value)
                    }
                    spellCheck={false}
                    value={cue.source}
                  />
                </label>
                <label className="cue-field cue-field--translation">
                  <span>번역</span>
                  <textarea
                    aria-label={`${index + 1}번 번역`}
                    onChange={(event) =>
                      updateCue(index, 'translation', event.currentTarget.value)
                    }
                    spellCheck={false}
                    value={cue.translation}
                  />
                </label>
                <button
                  className="row-reset"
                  disabled={!isEdited}
                  onClick={() => resetCue(index)}
                  type="button">
                  되돌리기
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <details className="panel raw-panel">
        <summary>SRT 원문 미리보기</summary>
        <textarea className="srt-preview" readOnly spellCheck={false} value={srt} />
      </details>
    </main>
  );
}

export default App;
