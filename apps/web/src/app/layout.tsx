import type { Metadata } from 'next';
import { Outfit, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
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
  title: {
    default: `${PRODUCT_NAME} - Shared Expenses, Settled Fairly`,
    // A page that names itself reads "<page> · Splitbook", so a row of tabs tells them apart.
    template: `%s · ${PRODUCT_NAME}`,
  },
  description:
    'Track group expenses, settle debts with minimal transactions, and never argue about money again.',
  // The brand kit's icons (docs/design/brand). There is no app/favicon.ico on purpose: that
  // file convention would override these.
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/brand/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
