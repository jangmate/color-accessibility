import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../types';
import { recommendColor } from '../utils/colorUtils';

// 명도 계산 유틸리티 함수들
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getLuminance(r: number, g: number, b: number) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(hex1: string, hex2: string) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  if (!rgb1 || !rgb2) return 0;

  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

interface ImageModalProps {
  result: AnalysisResult;
  isOpen: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

export function ImageModal({
  result,
  isOpen,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}: ImageModalProps) {
  const [fgColor, setFgColor] = useState<string>('');
  const [bgColor, setBgColor] = useState<string>('');
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null);
  const [showBoundingBox, setShowBoundingBox] = useState<boolean>(true);

  const pickColor = async (setColor: (color: string) => void) => {
    if (!('EyeDropper' in window)) {
      alert('스포이드 기능이 지원되지 않는 브라우저입니다.');
      return;
    }
    try {
      // @ts-ignore
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      setColor(result.sRGBHex);
    } catch (e) {
      console.log('색상 선택 취소됨');
    }
  };

  const manualContrast = (fgColor && bgColor) ? getContrastRatio(fgColor, bgColor).toFixed(2) : null;

  const typeLabel: Record<string, string> = {
    normal_text: '일반 텍스트',
    large_text: '큰 텍스트',
    ui_component: 'UI 컴포넌트',
  };

  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrevious && onPrevious) {
        onPrevious();
      } else if (e.key === 'ArrowRight' && hasNext && onNext) {
        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, onPrevious, onNext, hasPrevious, hasNext]);

  if (!isOpen) {
    if (fgColor) setFgColor('');
    if (bgColor) setBgColor('');
    return null;
  }

  return (
    <div className="image-modal-overlay" onClick={onClose}>
      <div className="image-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="image-modal__close"
          onClick={onClose}
          aria-label="닫기"
          title="닫기 (ESC)"
        >
          ✕
        </button>

        <div className="image-modal__content" style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={result.imageData}
              alt={result.filename}
              className="image-modal__image"
              style={{ display: 'block', maxWidth: '100%', maxHeight: '65vh', width: 'auto', height: 'auto' }}
            />
            {showBoundingBox && result.analysis && result.analysis.elements.map(el => {
              if (!el.boundingBox) return null;
              const [x, y, w, h] = el.boundingBox;
              const isHovered = hoveredElementId === el.id;
              const isFail = !el.wcagAA;
              const borderColor = isFail ? 'rgba(239, 68, 68, 1)' : 'rgba(34, 197, 94, 1)';
              const backgroundColor = isFail ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)';

              return (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${w}%`,
                    height: `${h}%`,
                    border: `2px solid ${borderColor}`,
                    backgroundColor: isHovered ? backgroundColor : 'transparent',
                    boxShadow: isHovered ? `0 0 10px ${borderColor}` : 'none',
                    zIndex: isHovered ? 10 : 1,
                    pointerEvents: 'none',
                    transition: 'all 0.2s',
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="image-modal__info">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h2 className="image-modal__filename" style={{ margin: 0 }}>{result.filename}</h2>
            <button
              onClick={() => setShowBoundingBox(!showBoundingBox)}
              style={{
                padding: '6px 12px',
                backgroundColor: showBoundingBox ? '#ef4444' : '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'background-color 0.2s'
              }}
            >
              위치보기 {showBoundingBox ? '끄기' : '켜기'}
            </button>
          </div>
          {result.analysis && (
            <p className="image-modal__status">
              {result.analysis.overallPass ? '✓ WCAG AA 통과' : '✗ WCAG AA 미충족'}
            </p>
          )}

          {result.analysis && result.analysis.elements.length > 0 && (
            <div className="modal-elements-list">
              <h3>감지된 요소 상세</h3>
              <div className="modal-elements-grid">
                {result.analysis.elements.map((el, i) => {
                  const targetRatio = (el.type === 'large_text' || el.type === 'ui_component') ? 3.0 : 4.5;
                  const isFail = !el.wcagAA;
                  const recommendedFg = isFail ? recommendColor(el.foregroundColor, el.backgroundColor, targetRatio) : null;

                  return (
                    <div
                      key={el.id || i}
                      className={`modal-element-card${isFail ? ' modal-element-card--fail' : ''}`}
                      onMouseEnter={() => setHoveredElementId(el.id)}
                      onMouseLeave={() => setHoveredElementId(null)}
                      style={{ cursor: el.boundingBox ? 'pointer' : 'default', border: hoveredElementId === el.id ? `2px solid ${isFail ? '#ef4444' : '#22c55e'}` : undefined }}
                    >
                      <div className="modal-element-card__header">
                        <div className="modal-element-card__colors">
                          <div className="color-pair__item">
                            <span className="color-swatch" style={{ backgroundColor: el.foregroundColor }} title={`전경색: ${el.foregroundColor}`} />
                            <span className="color-code">{el.foregroundColor}</span>
                          </div>
                          <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 1l7 7-7 7M1 8h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
                          <div className="color-pair__item">
                            <span className="color-swatch" style={{ backgroundColor: el.backgroundColor }} title={`배경색: ${el.backgroundColor}`} />
                            <span className="color-code">{el.backgroundColor}</span>
                          </div>
                        </div>
                        <div className="modal-element-card__ratio">
                          <strong className={isFail ? 'fail-text' : 'pass-text'}>{el.contrastRatio.toFixed(2)} : 1</strong>
                        </div>
                      </div>
                      <div className="modal-element-card__body">
                        <div className="modal-element-card__desc">{el.description}</div>
                        <div className="modal-element-card__meta">
                          <span className="modal-element-card__type">{typeLabel[el.type] || el.type}</span>
                          <span className="modal-element-card__loc">{el.location}</span>
                        </div>
                      </div>

                      {isFail && recommendedFg && (
                        <div className="modal-element-card__ai-recommend">
                          <div className="ai-recommend-title">✨ AI 명도 추천 (목표 {targetRatio}:1)</div>
                          <div className="ai-colors">
                            <div className="ai-color-item">
                              <span className="color-swatch" style={{ backgroundColor: recommendedFg }} />
                              <span>추천: {recommendedFg.toUpperCase()}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="manual-check">
            <h3>수동 명암비 검수</h3>
            <div className="color-pickers">
              <div className="picker-group">
                <span className="color-swatch" style={{ backgroundColor: fgColor || 'transparent' }}></span>
                <button type="button" onClick={() => pickColor(setFgColor)}>전경색 스포이드</button>
                <span>{fgColor || '선택 안됨'}</span>
              </div>
              <div className="picker-group">
                <span className="color-swatch" style={{ backgroundColor: bgColor || 'transparent' }}></span>
                <button type="button" onClick={() => pickColor(setBgColor)}>배경색 스포이드</button>
                <span>{bgColor || '선택 안됨'}</span>
              </div>
            </div>
            {manualContrast && (
              <p className="manual-result">
                계산된 명암비: <strong>{manualContrast} : 1</strong>
                ({Number(manualContrast) >= 4.5 ? 'AA 통과' : Number(manualContrast) >= 3 ? 'Large 텍스트 통과' : '미충족'})
              </p>
            )}
          </div>
        </div>

        {(hasPrevious || hasNext) && (
          <div className="image-modal__nav">
            {hasPrevious && (
              <button
                className="image-modal__nav-btn image-modal__nav-btn--prev"
                onClick={onPrevious}
                aria-label="이전 이미지"
                title="이전 이미지 (←)"
              >
                ‹
              </button>
            )}
            {hasNext && (
              <button
                className="image-modal__nav-btn image-modal__nav-btn--next"
                onClick={onNext}
                aria-label="다음 이미지"
                title="다음 이미지 (→)"
              >
                ›
              </button>
            )}
          </div>
        )}

        <div className="image-modal__keyboard-hint">
          ESC: 닫기 {hasPrevious && '← : 이전'} {hasNext && '→ : 다음'}
        </div>
      </div>
    </div>
  );
}
