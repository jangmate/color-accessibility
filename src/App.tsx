import { useState, useEffect } from 'react';
import { DropZone } from './components/DropZone';
import { ClipboardInput } from './components/ClipboardInput';
import { ImageCard } from './components/ImageCard';
import { ImageModal } from './components/ImageModal';
import { AuthModal } from './components/AuthModal';
import type { AnalysisResult, UploadStatus } from './types';
import './App.css';

export default function App() {
  const [currentUser, setCurrentUser] = useState<{ id: number, username: string } | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ isOpen: boolean; index: number }>({
    isOpen: false,
    index: 0,
  });
  const [queue, setQueue] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // 사용자 정보 불러오기
  useEffect(() => {
    fetch('/api/me')
      .then(res => res.json())
      .then(data => {
        if (data.user) setCurrentUser(data.user);
      })
      .catch(e => console.error('사용자 정보 불러오기 실패:', e));
  }, []);

  // 로그인 상태가 변경될 때 히스토리 항목 불러오기
  useEffect(() => {
    if (currentUser) {
      fetchHistory();
    } else {
      setHistory([]); // 로그아웃 시 히스토리 지움
    }
  }, [currentUser]);

  const fetchHistory = async (search = '') => {
    if (!currentUser) return; // 비로그인 시 요청 안 함
    try {
      const url = search ? `/api/history?search=${encodeURIComponent(search)}` : '/api/history';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (e) {
      console.error('히스토리 불러오기 실패:', e);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // 대기열 처리 로직
  useEffect(() => {
    if (queue.length > 0 && !isProcessing) {
      processQueue();
    }
  }, [queue, isProcessing]);

  const processQueue = async () => {
    setIsProcessing(true);
    setStatus('uploading');

    const filesToProcess = [...queue];
    setQueue([]); // 큐 비우기

    try {
      // 1. 선택 즉시 '분석대기중(analyzing)' 상태로 UI 업데이트
      const fileReaders = filesToProcess.map((file) => {
        return new Promise<{ filename: string; imageData: string; status: 'analyzing' }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({
              filename: file.name,
              imageData: e.target?.result as string,
              status: 'analyzing'
            });
          };
          reader.readAsDataURL(file);
        });
      });

      const previews = await Promise.all(fileReaders);
      const initialResults: AnalysisResult[] = previews.map((p) => ({
        ...p,
        analysis: undefined,
      }));
      setResults((prev) => [...initialResults, ...prev]);

      // 하나씩 또는 일괄 분석
      const formData = new FormData();
      filesToProcess.forEach((file) => formData.append('images', file));

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `서버 오류 (${response.status})`);
      }

      const data = await response.json();

      setResults((prev) => {
        return prev.map((result) => {
          // filesToProcess 안에 포함된 이미지들에 대해서만 처리
          const isProcessedHere = filesToProcess.some(f => f.name === result.filename);
          if (!isProcessedHere) return result;

          const analysisResult = data.results.find(
            (r: AnalysisResult) => r.filename === result.filename || r.filename.startsWith(result.filename.slice(0, 100))
          );
          if (analysisResult) {
            return { ...result, analysis: analysisResult.analysis, status: 'done' as const };
          }
          // 분석은 됐는데 결과가 안 왔다면 error 처리
          return { ...result, status: 'error' as const };
        });
      });

      // 새로운 결과가 추가되었으므로 히스토리도 다시 불러옵니다
      fetchHistory(historySearch);

      // 큐(대기열)와 관계없이 현재 배치 처리가 끝났으므로 done 처리
      // 진행할 항목이 더 있다면 useEffect에서 다시 queue 길이 확인 후 uploading 상태로 만듦
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      
      // 에러 발생 시 현재 분석 중이었던 목록을 error 상태로 변경
      setResults((prev) => 
        prev.map(r => filesToProcess.some(f => f.name === r.filename) ? { ...r, status: 'error' as const } : r)
      );

      setStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFilesSelected = (files: File[]) => {
    // 파일 확장자 필터링 (PNG, JPG, WebP)
    const validExtensions = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const validFiles = files.filter(f => validExtensions.includes(f.type));

    if (validFiles.length !== files.length) {
      setError('PNG, JPG, WebP 형식의 파일만 업로드할 수 있습니다.');
    }

    if (validFiles.length > 0) {
      setQueue((prev) => [...prev, ...validFiles]);
      setError(null);
    }
  };

  const handleReset = () => {
    setResults([]);
    setStatus('idle');
    setError(null);
    setQueue([]);
    setIsProcessing(false);
  };

  const handleImageClick = (index: number) => {
    setModalState({ isOpen: true, index });
  };

  const handleModalClose = () => {
    setModalState({ isOpen: false, index: 0 });
  };

  const handleModalPrevious = () => {
    setModalState((prev) => ({
      ...prev,
      index: prev.index > 0 ? prev.index - 1 : results.length - 1,
    }));
  };

  const handleModalNext = () => {
    setModalState((prev) => ({
      ...prev,
      index: prev.index < results.length - 1 ? prev.index + 1 : 0,
    }));
  };

  const handleHistorySearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHistorySearch(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchHistory(historySearch);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      setCurrentUser(null);
    } catch(e) {
      console.error(e);
    }
  };

  const visibleHistory = showAllHistory ? history : history.slice(0, 6);

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
          {currentUser ? (
            <div className="user-info">
              <span className="welcome-text">환영합니다, <strong>{currentUser.username}</strong>님!</span>
              <button className="btn btn--secondary" onClick={handleLogout}>로그아웃</button>
            </div>
          ) : (
            <button className="btn btn--primary" onClick={() => setIsAuthModalOpen(true)}>
              로그인 / 회원가입
            </button>
          )}
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
            disabled={false} // 분석 중에도 업로드 가능하도록 활성화
          />

          <ClipboardInput
            onImagesSelected={handleFilesSelected}
            disabled={false}
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
                <ImageCard
                  key={`${result.filename}-${i}`}
                  result={result}
                  onImageClick={() => handleImageClick(i)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 히스토리 섹션 */}
        <section className="results-section history-section">
          <div className="results-header">
            <h2>최근 검수 기록 ({history.length}개)</h2>
            {currentUser && (
              <form onSubmit={handleSearchSubmit} className="history-search-form">
                <input
                  type="text"
                  placeholder="결과 검색..."
                  value={historySearch}
                  onChange={handleHistorySearch}
                  className="history-search-input"
                />
                <button type="submit" className="btn btn--secondary">검색</button>
              </form>
            )}
          </div>
          
          {!currentUser ? (
            <div className="history-empty">
              <p>로그인하여 본인의 이전 검수 기록을 확인하세요.</p>
              <button className="btn btn--primary" style={{ marginTop: '12px' }} onClick={() => setIsAuthModalOpen(true)}>
                로그인 하기
              </button>
            </div>
          ) : history.length > 0 ? (
            <>
              <div className="results-list">
                {visibleHistory.map((item, i) => (
                  <ImageCard
                    key={`history-${item.id || i}`}
                    result={{...item, status: 'done'}}
                    onImageClick={() => {
                      // 모달 처리를 위해 임시로 results에 넣거나 모달용 분리 가능
                      // 간단하게 results를 통해 모달을 띄우는 구조라면 해당 기록을 results 맨 앞에 추가
                      setResults(prev => [item, ...prev.filter(r => r.filename !== item.filename)]);
                      setModalState({ isOpen: true, index: 0 });
                    }}
                  />
                ))}
              </div>
              {history.length > 6 && (
                <div className="history-expand">
                  <button 
                    className="btn btn--secondary" 
                    onClick={() => setShowAllHistory(!showAllHistory)}
                  >
                    {showAllHistory ? '접기' : '더보기'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="history-empty">최근 기록이 없습니다.</p>
          )}
        </section>

        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={() => setIsAuthModalOpen(false)} 
          onSuccess={(user) => {
            setCurrentUser(user);
            setIsAuthModalOpen(false);
          }} 
        />

        {results.length > 0 && (
          <ImageModal
            result={results[modalState.index]}
            isOpen={modalState.isOpen}
            onClose={handleModalClose}
            onPrevious={handleModalPrevious}
            onNext={handleModalNext}
            hasPrevious={results.length > 1}
            hasNext={results.length > 1}
          />
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
        <p>WCAG 2.1 기반 명도대비 분석</p>
      </footer>
    </div>
  );
}
