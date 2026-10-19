import { Chip } from '@heroui/react';

/** Marks a meeting someone else shared with the signed-in user (they have read-only access). */
export function SharedChip() {
  return (
    <Chip size="sm" variant="soft" color="accent" className="shrink-0 whitespace-nowrap">
      Shared
    </Chip>
  );
}
