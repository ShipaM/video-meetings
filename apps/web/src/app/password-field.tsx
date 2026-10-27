'use client';

import { Button, Description, FieldError, InputGroup, Label, TextField } from '@heroui/react';
import { type Ref, useState } from 'react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './register/constants';

/** Length check of a new password; counts code points, like the API's `MinLength` / `MaxLength`. */
export function getPasswordLengthError(value: string): string | null {
  const length = [...value].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

function EyeIcon({ isOff }: { isOff: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {isOff ? <path d="m3 3 18 18" /> : null}
    </svg>
  );
}

type PasswordFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error: string | null;
  autoComplete: 'new-password' | 'current-password';
  placeholder: string;
  label?: string;
  name?: string;
  hint?: string;
  isDisabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

export function PasswordField({
  label = 'Password',
  name = 'password',
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  placeholder,
  hint,
  isDisabled,
  inputRef,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField
      isRequired
      name={name}
      type={isVisible ? 'text' : 'password'}
      autoComplete={autoComplete}
      isDisabled={isDisabled}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      isInvalid={error !== null}
      validationBehavior="aria"
    >
      <Label>{label}</Label>
      <InputGroup fullWidth aria-label={label}>
        <InputGroup.Input ref={inputRef} placeholder={placeholder} />
        <InputGroup.Suffix className="pr-1">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            isDisabled={isDisabled}
            aria-label={`${isVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            aria-pressed={isVisible}
            onPress={() => setIsVisible((visible) => !visible)}
          >
            <EyeIcon isOff={isVisible} />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {error === null && hint ? <Description className="text-sm">{hint}</Description> : null}
      <FieldError className="text-sm">{error}</FieldError>
    </TextField>
  );
}
