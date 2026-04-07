import { useState, useRef } from 'react';

interface ClipboardInputProps {
  onImagesSelected: (files: File[]) => void;
  disabled?: boolean;
}

interface ClipboardImage {
  id: string;
  dataUrl: string;
  fileName: string;
}

export function ClipboardInput({ onImagesSelected, disabled }: ClipboardInputProps) {
  const [images, setImages] = useState<ClipboardImage[]>([]);
  const inputRef = useRef<HTMLDivElement>(null);

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disabled) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImages = false;
    let hasText = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.kind === 'file' && item.type.startsWith('image/')) {
        hasImages = true;
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            const timestamp = Date.now() + Math.random().toString(36).substr(2, 9);
            setImages((prev) => [
              ...prev,
              {
                id: timestamp,
                dataUrl,
                fileName: `clipboard_${new Date().toLocaleTimeString('ko-KR', { hour12: false })}.png`,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      } else if (item.kind === 'string') {
        hasText = true;
      }
    }

    if (hasText && !hasImages) {
      alert('텍스트는 붙여넣을 수 없습니다. 이미지만 붙여넣어주세요.');
      e.preventDefault();
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleSubmit = () => {
    if (images.length === 0) {
      alert('업로드할 이미지를 선택해주세요.');
      return;
    }

    // DataURL을 File 객체로 변환
    const files = images.map((img) => {
      const arr = img.dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(arr[1]);
      const n = bstr.length;
      const u8arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      return new File([u8arr], img.fileName, { type: mime });
    });

    onImagesSelected(files);
    setImages([]); // 업로드 후 초기화
  };

  const handleClear = () => {
    setImages([]);
  };

  return (
    <div className="clipboard-input">
      <div className="clipboard-input__label">
        <h3>클립보드 이미지</h3>
        <p>Ctrl+V로 이미지를 붙여넣으세요</p>
      </div>

      <div
        ref={inputRef}
        className={`clipboard-input__area${disabled ? ' clipboard-input__area--disabled' : ''}`}
        onPaste={handlePaste}
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        aria-label="클립보드 이미지 붙여넣기 영역"
      >
        {images.length === 0 ? (
          <div className="clipboard-input__placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 5a1 1 0 011-1h4a1 1 0 011 1v1H9V5z" />
              <path d="M3 7h18a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V9a2 2 0 012-2z" />
            </svg>
            <p>여기에 클립보드 이미지를 붙여넣으세요</p>
          </div>
        ) : (
          <div className="clipboard-input__previews">
            {images.map((img) => (
              <div key={img.id} className="clipboard-input__preview-item">
                <div className="clipboard-input__preview-image">
                  <img src={img.dataUrl} alt="preview" />
                </div>
                <button
                  type="button"
                  className="clipboard-input__remove-btn"
                  onClick={() => handleRemoveImage(img.id)}
                  aria-label="이미지 제거"
                  title="제거"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="clipboard-input__info">
          <span className="clipboard-input__count">
            선택됨: <strong>{images.length}개</strong>
          </span>
          <p className="clipboard-input__tip">더 많은 이미지를 붙여넣을 수 있습니다</p>
        </div>
      )}

      <div className="clipboard-input__actions">
        {images.length > 0 && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleClear}
            disabled={disabled}
          >
            초기화
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={disabled || images.length === 0}
        >
          {images.length > 0 ? `업로드 (${images.length}개)` : '업로드'}
        </button>
      </div>
    </div>
  );
}

