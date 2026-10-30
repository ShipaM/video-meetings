import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getAvatarUrl } from '../../profile';
import {
  AVATAR_UPLOAD_GONE_MESSAGE,
  AVATAR_UPLOADING_MESSAGE,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_TOO_LONG_MESSAGE,
} from '../constants';
import { isChangePasswordTarget } from './change-password-form';
import { fetchProfile, saveProfile } from './profile-api';
import { useAvatarUpload } from './use-avatar-upload';

type LoadState = { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready' };

function getNameError(value: string): string | null {
  // Code points, like the API's `@MaxLength`: an emoji counts as one character.
  return [...value.trim()].length > PROFILE_NAME_MAX_LENGTH ? PROFILE_NAME_TOO_LONG_MESSAGE : null;
}

/** Loads the profile into the Profile Edit form and saves the name and avatar. */
export function useProfileForm() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ type: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [savedAvatarUrl, setSavedAvatarUrl] = useState<string | null>(null);
  const avatar = useAvatarUpload();
  const { reset: resetAvatar } = avatar;
  const [touched, setTouched] = useState(false);
  const [nameServerError, setNameServerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const saveControllerRef = useRef<AbortController | null>(null);

  // Next.js keeps this page's state when it is left; the cleanup also runs then, so a save still in
  // flight never navigates away from the page the user went to.
  useEffect(() => () => saveControllerRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProfile(controller.signal).then(
      (result) => {
        // Unauthorized: the token was cleared, which redirects to /login.
        if (result.type === 'unauthorized') return;
        if (result.type === 'error') {
          setLoadState(result);
          return;
        }
        // A return visit starts from the saved name, not the edits and errors left from the last one.
        setName(result.profile.name ?? '');
        setSavedAvatarUrl(getAvatarUrl(result.profile));
        resetAvatar();
        setTouched(false);
        setNameServerError(null);
        setError(null);
        setLoadState({ type: 'ready' });
      },
      () => {
        // Aborted: the page was left.
      },
    );
    return () => controller.abort();
  }, [attempt, resetAvatar]);

  useEffect(() => {
    // Opened through Change password: the password form has the focus.
    if (loadState.type === 'ready' && !isChangePasswordTarget()) nameRef.current?.focus();
  }, [loadState.type]);

  function handleRetry() {
    setLoadState({ type: 'loading' });
    setAttempt((current) => current + 1);
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameServerError(null);
  }

  function handleNameBlur() {
    setTouched(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in the field submits even while the Save button is pending.
    if (isPending) return;
    setTouched(true);

    if (getNameError(name)) {
      nameRef.current?.focus();
      return;
    }
    if (avatar.isUploading) {
      avatar.setError(AVATAR_UPLOADING_MESSAGE);
      return;
    }

    setIsPending(true);
    setError(null);
    setNameServerError(null);
    const controller = new AbortController();
    saveControllerRef.current = controller;

    try {
      const result = await saveProfile(name, avatar.change, controller.signal);
      if (result.type === 'name-rejected') {
        setNameServerError(result.message);
        nameRef.current?.focus();
      } else if (result.type === 'upload-gone') {
        resetAvatar(AVATAR_UPLOAD_GONE_MESSAGE);
      } else if (result.type === 'error') {
        setError(result.message);
      } else if (result.type === 'saved') {
        // Replace, so Back from /profile does not return to the form that was just saved.
        router.replace('/profile');
      }
    } catch {
      // Aborted: the page was left.
    } finally {
      setIsPending(false);
    }
  }

  return {
    loadState,
    name,
    nameError: nameServerError ?? (touched ? getNameError(name) : null),
    nameRef,
    savedAvatarUrl,
    avatar,
    error,
    isPending,
    handleRetry,
    handleNameChange,
    handleNameBlur,
    handleSubmit,
  };
}
