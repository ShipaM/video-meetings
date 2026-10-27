import { Avatar } from '@heroui/react';
import type { ComponentProps } from 'react';

/** The user's avatar while none can be set: a person icon in a circle. Decorative. */
export function AvatarPlaceholder({
  size,
  className,
  iconClassName,
}: {
  size?: ComponentProps<typeof Avatar>['size'];
  className: string;
  iconClassName: string;
}) {
  return (
    // HeroUI rounds avatars by a fixed radius, which squares off large ones; keep it a circle.
    <Avatar size={size} className={`rounded-full ${className}`} aria-hidden="true">
      <Avatar.Fallback>
        <svg
          viewBox="0 0 24 24"
          className={iconClassName}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </Avatar.Fallback>
    </Avatar>
  );
}
