import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { THEME_SCRIPT } from './constants';
import { ThemeToggle } from './theme-toggle';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Video Meetings',
  description: 'Host and join video meetings',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="aurora" aria-hidden="true">
          <span className="aurora__blob aurora__blob--1" />
          <span className="aurora__blob aurora__blob--2" />
          <span className="aurora__blob aurora__blob--3" />
        </div>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
