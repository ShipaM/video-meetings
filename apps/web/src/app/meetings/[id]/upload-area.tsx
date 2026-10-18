'use client';

import { Button, CloseButton, ProgressBar } from '@heroui/react';
import { useRef, useState } from 'react';
import { formatFileSize } from '../../meetings';
import { ACCEPT_ATTRIBUTE, ALLOWED_TYPES_LABEL } from './constants';
import { useFileUploads, type UploadItem } from './use-file-uploads';

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  rejected: 'Not uploaded',
  queued: 'Waiting…',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Upload failed',
};

function UploadRow({ item, onDismiss }: { item: UploadItem; onDismiss: () => void }) {
  const hasError = item.status === 'rejected' || item.status === 'failed';

  return (
    <li
      className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 ${
        hasError ? 'border-danger/40 bg-danger/5' : 'border-default'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium break-all">{item.name}</span>
          <span className="text-muted text-sm">
            {formatFileSize(item.size)} · {STATUS_TEXT[item.status]}
          </span>
        </div>
        {hasError && <CloseButton aria-label={`Dismiss ${item.name}`} onPress={onDismiss} />}
      </div>

      {!hasError && (
        <ProgressBar
          aria-label={`Uploading ${item.name}`}
          value={Math.round(item.progress * 100)}
          color={item.status === 'done' ? 'success' : 'accent'}
          size="sm"
          className="gap-1"
        >
          <ProgressBar.Output className="text-muted self-end text-xs tabular-nums" />
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      )}

      {hasError && (
        <p role="alert" className="text-danger text-sm">
          {item.error}
        </p>
      )}
    </li>
  );
}

export function UploadArea({
  meetingId,
  onUploaded,
}: {
  meetingId: string;
  onUploaded: () => Promise<void>;
}) {
  const { items, addFiles, dismiss } = useFileUploads(meetingId, onUploaded);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the pointer really left.
  const dragDepth = useRef(0);

  function handleDragEnter(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = ''; // picking the same file again fires `change` again
  }

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-3">
      <h2 id="upload-heading" className="text-muted text-sm font-medium">
        Upload files
      </h2>

      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-dragging={isDragging || undefined}
        className="border-default data-dragging:border-accent data-dragging:bg-accent/10 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-200"
      >
        <span className="text-accent">
          <UploadIcon />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            {isDragging ? 'Drop the files to upload them' : 'Drag files here or choose them'}
          </p>
          <p id="upload-hint" className="text-muted text-sm">
            {ALLOWED_TYPES_LABEL} · up to 2 GB each
          </p>
        </div>
        <Button
          variant="secondary"
          aria-describedby="upload-hint"
          onPress={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      <ul aria-label="Uploads" className="flex flex-col gap-2 empty:hidden">
        {items.map((item) => (
          <UploadRow key={item.key} item={item} onDismiss={() => dismiss(item.key)} />
        ))}
      </ul>
    </section>
  );
}
