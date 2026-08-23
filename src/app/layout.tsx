import type { Metadata } from 'next';
import { Outfit, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import AuthProvider from '@/providers/AuthProvider';
import ThemeProvider from '@/providers/ThemeProvider';
import { PRODUCT_NAME, THEME_STORAGE_KEY } from '@/lib/product';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Shared Expenses, Settled Fairly`,
  description:
    'Track group expenses, settle debts with minimal transactions, and never argue about money again.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');if(!m)m=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.style.colorScheme=m;document.documentElement.setAttribute('data-theme',m)}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${outfit.variable} ${plexMono.variable}`}>
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
