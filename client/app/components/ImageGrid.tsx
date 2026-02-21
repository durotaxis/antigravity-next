'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

type ImageAsset = {
  id: number;
  url: string; // または filename
  alt?: string;
};

type ImageGridProps = {
  images: ImageAsset[];
  onImageClick: (url: string, id: number) => void;
};

type LazyImageProps = {
  src: string;
  alt: string;
};

function LazyImage({ src, alt }: LazyImageProps) {
  const [isVisible, setIsVisible] = useState(
    () => typeof window === 'undefined' || !('IntersectionObserver' in window)
  );
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isVisible) return;

    const target = holderRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px 0px', threshold: 0.01 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div ref={holderRef} className="relative h-full w-full">
      {isVisible ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          unoptimized
          decoding="async"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-gray-200" aria-hidden="true" />
      )}
    </div>
  );
}

export default function ImageGrid({ images, onImageClick }: ImageGridProps) {
  if (!images || images.length === 0) {
    return <div className="text-gray-400 text-sm italic p-4 text-center">No images analyzed yet.</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
      {images.map((img) => (
        <div
          key={img.id}
          className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100 cursor-pointer border border-gray-200 hover:border-blue-400 transition-all duration-300 shadow-sm hover:shadow-md"
          onClick={() => onImageClick(img.url, img.id)}
        >
          {/* 画像 */}
          <LazyImage src={img.url} alt={img.alt || 'Run analysis'} />

          {/* ホバー時のオーバーレイ */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="bg-white/90 text-gray-800 text-xs font-bold px-3 py-1 rounded-full shadow-lg pointer-events-none">
              View
            </span>


          </div>
        </div>
      ))}
    </div>
  );
}
