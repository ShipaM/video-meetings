'use client';

import { Button, ProgressBar } from '@heroui/react';
import { useRef, useState } from 'react';
import { UserAvatar } from '../../user-avatar';
import { AVATAR_ACCEPT_ATTRIBUTE, AVATAR_HINT } from '../constants';
import type { AvatarChange } from './use-avatar-upload';

/**
 * The avatar part of Profile Edit: a circular preview of what Save will keep (the saved avatar,
 * the picked image or the placeholder), Choose image / Remove, the upload progress and the reason
 * a file was rejected.
 */
export function AvatarPicker({
  savedAvatarUrl,
  change,
  isUploading,
  error,
  onPick,
  onRemove,
}: {
  /** Absolute URL of the saved avatar, or `null`. */
  savedAvatarUrl: string | null;
  change: AvatarChange;
  isUploading: boolean;
  error: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // An image that did not load (e.g. its signed URL expired) shows the placeholder instead.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const previewUrl =
    change.type === 'upload' ? change.previewUrl : change.type === 'keep' ? savedAvatarUrl : null;

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset, so picking the same file again still reports a change.
    event.target.value = '';
    if (file) onPick(file);
  }

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby="avatar-hint">
      <legend className="mb-2 text-sm font-medium">Avatar</legend>
      <div className="flex items-center gap-4">
        {previewUrl === null || previewUrl === failedUrl ? (
          <UserAvatar className="size-20 shrink-0" iconClassName="size-10" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={change.type === 'upload' ? 'New avatar preview' : 'Current avatar'}
            className="bg-default size-20 shrink-0 rounded-full object-cover"
            onError={() => setFailedUrl(previewUrl)}
          />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onPress={() => inputRef.current?.click()}>
              {previewUrl === null ? 'Choose image' : 'Change image'}
            </Button>
            {previewUrl !== null && (
              <Button variant="danger-soft" onPress={onRemove}>
                Remove
              </Button>
            )}
          </div>
          <p id="avatar-hint" className="text-muted text-sm">
            {AVATAR_HINT}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {isUploading && change.type === 'upload' && (
        <ProgressBar
          aria-label="Avatar upload progress"
          value={Math.round(change.progress * 100)}
          size="sm"
          className="gap-1"
        >
          <ProgressBar.Output className="text-muted self-end text-xs tabular-nums" />
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      )}

      <div aria-live="polite" className="empty:hidden">
        {error !== null && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  );
}
