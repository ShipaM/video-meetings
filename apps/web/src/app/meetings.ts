export type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  createdAt: string;
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function formatMeetingDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
