'use client';

import { useOverlayState } from '@heroui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DIALOG_CLOSE_FALLBACK_MS } from './constants';

/** Outcome of a removal request (a file deletion, a participant removal). */
export type RemovalResult =
  { type: 'removed' } | { type: 'unauthorized' } | { type: 'error'; message: string };

/**
 * State of a confirmation dialog that removes a row and stays open until the API has answered; a
 * failure is shown inside it. The row (with the button that opened the dialog) is reported removed
 * only once the dialog has closed and returned focus to that button, so the page can then move
 * focus elsewhere instead of losing it. Put `UnmountListener` with `onDialogUnmount` inside the
 * dialog content; a fallback timer covers content that stays mounted after closing.
 */
export function useConfirmedRemoval(onRemoved: () => void) {
  const dialog = useOverlayState();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRemoved = useRef(false);
  const isReported = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Reports the removal once, whichever comes first: the dialog unmounting or the timer. */
  const reportRemoved = useCallback(() => {
    if (isReported.current) return;
    isReported.current = true;
    onRemoved();
  }, [onRemoved]);

  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  const onDialogUnmount = useCallback(() => {
    if (isRemoved.current) reportRemoved();
  }, [reportRemoved]);

  function onOpenChange(isOpen: boolean) {
    if (isPending) return;
    setError(null);
    dialog.setOpen(isOpen);
  }

  async function confirm(remove: () => Promise<RemovalResult>) {
    setIsPending(true);
    setError(null);
    const result = await remove();
    setIsPending(false);
    if (result.type === 'removed') {
      isRemoved.current = true;
      dialog.close();
      fallbackTimer.current = setTimeout(reportRemoved, DIALOG_CLOSE_FALLBACK_MS);
    } else if (result.type === 'error') {
      setError(result.message);
    }
    // `unauthorized`: the token is cleared, the page goes to the login page.
  }

  return {
    isOpen: dialog.isOpen,
    open: dialog.open,
    onOpenChange,
    isPending,
    error,
    confirm,
    onDialogUnmount,
  };
}
