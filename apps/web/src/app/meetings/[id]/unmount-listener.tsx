'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `onUnmount` when the dialog content leaves the DOM, i.e. after its exit animation. React
 * Aria's `ModalOverlay` has no "closed" callback; unmounting the content is its end of closing.
 */
export function UnmountListener({ onUnmount }: { onUnmount: () => void }) {
  const callback = useRef(onUnmount);
  useEffect(() => {
    callback.current = onUnmount;
  }, [onUnmount]);
  useEffect(() => () => callback.current(), []);
  return null;
}
