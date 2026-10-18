import { Suspense } from 'react';
import { MeetingView } from './meeting-view';

// With Cache Components the params are runtime data, so reading them needs a Suspense boundary.
export default function MeetingPage({ params }: PageProps<'/meetings/[id]'>) {
  return (
    <Suspense fallback={<main className="flex flex-1" aria-busy="true" />}>
      {params.then(({ id }) => (
        <MeetingView meetingId={id} />
      ))}
    </Suspense>
  );
}
