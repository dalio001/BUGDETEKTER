import { useEffect, useRef, useState, type DragEvent } from 'react';

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;

export function Dropzone({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const addFiles = (incoming: FileList | File[]) => {
    const images = Array.from(incoming).filter((f) => f.type.startsWith('image/') && f.size <= MAX_SIZE);
    onChange([...files, ...images].slice(0, MAX_FILES));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  return (
    <div>
      <div
        className={`dropzone ${dragging ? 'drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        Drop screenshots here, or click to pick images (up to {MAX_FILES}, 5MB each)
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="dz-previews">
          {files.map((file, i) => (
            <div className="dz-thumb" key={i}>
              <img src={previews[i]} alt={file.name} title={file.name} />
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
