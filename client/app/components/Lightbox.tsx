'use client';

import { useEffect, useState, useRef } from 'react';

type LightboxProps = {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
};

export default function Lightbox({ isOpen, imageSrc, onClose }: LightboxProps) {
  // ズームと位置の状態管理
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const imageRef = useRef<HTMLImageElement>(null);

  // 画像が変わったらリセット
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageSrc]);

  // ESCキーとスクロール禁止制御
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose]);

  // マウスホイールでのズーム制御
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    if (e.deltaY < 0) {
      setScale(s => Math.min(s + 0.2, 5)); // 最大5倍
    } else {
      setScale(s => Math.max(s - 0.2, 1)); // 最小1倍
    }
  };

  // ドラッグ開始
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
      e.preventDefault(); // 画像のドラッグ禁止を防ぐ
    }
  };

  // ドラッグ中
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - startPos.x,
        y: e.clientY - startPos.y
      });
    }
  };

  // ドラッグ終了
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      onMouseUp={handleMouseUp}
    >
      {/* コントロールボタン群 */}
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(s + 0.5, 5)); }}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
          title="Zoom In"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(s - 0.5, 1)); }}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
          title="Zoom Out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors ml-2"
          title="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 画像コンテナ */}
      <div
        className="relative overflow-hidden w-full h-full flex items-center justify-center p-4"
        onWheel={handleWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={imageSrc}
          alt="Preview"
          draggable={false}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
          className="max-w-full max-h-[90vh] object-contain select-none shadow-2xl rounded-sm"
        />

        {/* ヒント表示 */}
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full pointer-events-none opacity-70">
          Scroll or Pinch to Zoom • Drag to Pan
        </div>
      </div>
    </div>
  );
}