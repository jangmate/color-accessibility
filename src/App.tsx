import { useState } from 'react';
import { DropZone } from './components/DropZone';
import { ClipboardInput } from './components/ClipboardInput';
import { ImageCard } from './components/ImageCard';
import type { AnalysisResult, UploadStatus } from './types';
import './App.css';

export default function App() {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleFilesSelected = async (files: File[]) => {
    setStatus('uploading');
    setError(null);

    // 먼저 이미지 미리보기 생성 (분석 결과 없이)
    const fileReaders = files.map((file) => {
      return new Promise<{ filename: string; imageData: string }>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            filename: file.name,
            imageData: e.target?.result as string,
          });
        };
        reader.readAsDataURL(file);
      });
    });

    try {
      // 이미지 미리보기를 먼저 UI에 추가
      const previews = await Promise.all(fileReaders);
      const initialResults: AnalysisResult[] = previews.map((p) => ({
        ...p,
        analysis: undefined,
      }));
      setResults((prev) => [...initialResults, ...prev]);

      // 분석 요청
      const formData = new FormData();
      files.forEach((file) => formData.append('images', file));

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `서버 오류 (${response.status})`);
      }

      const data = await response.json();
      
      // 분석 결과를 받으면 해당 이미지 업데이트
      setResults((prev) => {
        return prev.map((result) => {
          const analysisResult = data.results.find(
            (r: AnalysisResult) => r.filename === result.filename
          );
          return analysisResult ? { ...result, analysis: analysisResult.analysis } : result;
        });
      });

      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setStatus('error');
    } finally {
    }
  };

  const handleReset = () => {
    setResults([]);
    setStatus('idle');
    setError(null);
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__logo">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="2"/>
              <circle cx="10" cy="16" r="5" fill="currentColor" opacity="0.3"/>
              <circle cx="22" cy="16" r="5" fill="currentColor"/>
              <path d="M13 16a5 5 0 004.5 0" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <h1 className="app__title">명도대비 검사기</h1>
            <p className="app__subtitle">AI 기반 WCAG 색상 대비 접근성 분석</p>
          </div>
        </div>
        <div className="app__header-actions">
          <a
            href="https://www.w3.org/TR/WCAG21/#contrast-minimum"
            target="_blank"
            rel="noopener noreferrer"
            className="wcag-link"
          >
            WCAG 2.1 기준 보기
          </a>
          {results.length > 0 && (
            <button className="btn btn--secondary" onClick={handleReset}>
              초기화
            </button>
          )}
        </div>
      </header>

      <main className="app__main">
        <section className="upload-section">
          <DropZone
            onFilesSelected={handleFilesSelected}
            disabled={status === 'uploading'}
          />

          <ClipboardInput
            onImagesSelected={handleFilesSelected}
            disabled={status === 'uploading'}
          />

          {status === 'uploading' && (
            <div className="uploading-state" role="status" aria-live="polite">
              <div className="spinner" />
              <p>AI가 이미지를 분석하는 중입니다...</p>
              <p className="uploading-hint">이미지 수에 따라 수십 초 소요될 수 있습니다</p>
            </div>
          )}

          {status === 'error' && error && (
            <div className="error-banner" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd"/>
              </svg>
              <span>{error}</span>
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section className="results-section">
            <div className="results-header">
              <h2>분석 결과 ({results.length}개 이미지)</h2>
              <div className="results-legend">
                <span className="legend-item legend-item--pass">AA 통과</span>
                <span className="legend-item legend-item--fail">AA 실패</span>
              </div>
            </div>
            <div className="results-list">
              {results.map((result, i) => (
                <ImageCard key={`${result.filename}-${i}`} result={result} />
              ))}
            </div>
          </section>
        )}

        {status === 'idle' && results.length === 0 && (
          <section className="guide-section">
            <h2 className="guide-title">WCAG 명도대비 기준</h2>
            <div className="guide-grid">
              <div className="guide-card">
                <div className="guide-card__level">AA</div>
                <ul className="guide-card__list">
                  <li><strong>4.5:1</strong> — 일반 텍스트 (18pt 미만)</li>
                  <li><strong>3:1</strong> — 큰 텍스트 (18pt 이상 / 굵게 14pt 이상)</li>
                  <li><strong>3:1</strong> — UI 컴포넌트 및 그래픽</li>
                </ul>
              </div>
              <div className="guide-card">
                <div className="guide-card__level guide-card__level--aaa">AAA</div>
                <ul className="guide-card__list">
                  <li><strong>7:1</strong> — 일반 텍스트</li>
                  <li><strong>4.5:1</strong> — 큰 텍스트</li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="app__footer">
        <p>Powered by Claude AI · WCAG 2.1 기반 명도대비 분석</p>
      </footer>
    </div>
  );
}
