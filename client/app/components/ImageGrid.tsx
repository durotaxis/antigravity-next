'use client';

type ImageAsset = {
  id: number;
  url: string; // または filename
  alt?: string;
};

type ImageGridProps = {
  images: ImageAsset[];
  onImageClick: (url: string) => void;
};

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
          onClick={() => onImageClick(img.url)}
        >
          {/* 画像 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={img.alt || 'Run analysis'}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            loading="lazy"
          />
          
          {/* ホバー時のオーバーレイ */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
             <span className="bg-white/90 text-gray-800 text-xs font-bold px-3 py-1 rounded-full shadow-lg">
               View
             </span>
          </div>
        </div>
      ))}
    </div>
  );
}