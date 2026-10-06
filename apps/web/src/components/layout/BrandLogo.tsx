'use client';

import Image from 'next/image';
import Link from 'next/link';
import Box from '@mui/material/Box';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import { PRODUCT_NAME } from '@/lib/product';

/** Both logo variants share this viewBox (public/brand/logo-*.svg). */
const LOGO_WIDTH = 497;
const LOGO_HEIGHT = 128;

/** The brand standard's display heights: compact 24, header 32, large 40 (docs/design/brand). */
export type BrandLogoHeight = 24 | 32 | 40;

/** The displayed width for a height, from the artwork's own ratio. */
export function brandLogoWidth(height: BrandLogoHeight): number {
  return Math.round(((height * LOGO_WIDTH) / LOGO_HEIGHT) * 100) / 100;
}

interface BrandLogoProps {
  height?: BrandLogoHeight;
  /** Makes the logo the link to this page; it is then named "Splitbook home". */
  href?: string;
  onClick?: () => void;
  /** Extra styles for the link, such as a 44 px touch target in the phone drawer. */
  linkSx?: SxProps<Theme>;
}

/**
 * The Splitbook logo artwork: the light variant, or the dark one on a dark theme.
 * Width and height are both fixed from the ratio, and object-fit keeps the artwork whole,
 * so a flex parent's stretch can't distort it.
 */
export default function BrandLogo({ height = 32, href, onClick, linkSx }: BrandLogoProps) {
  const dark = useTheme().palette.mode === 'dark';
  const logo = (
    <Image
      src={dark ? '/brand/logo-dark.svg' : '/brand/logo-light.svg'}
      alt={href ? `${PRODUCT_NAME} home` : PRODUCT_NAME}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      loading="eager"
      style={{
        display: 'block',
        width: brandLogoWidth(height),
        height,
        flexShrink: 0,
        objectFit: 'contain',
      }}
    />
  );

  if (!href) return logo;

  return (
    <Box
      component={Link}
      href={href}
      onClick={onClick}
      sx={[
        { display: 'inline-flex', flexShrink: 0, borderRadius: 1 },
        ...(Array.isArray(linkSx) ? linkSx : [linkSx]),
      ]}
    >
      {logo}
    </Box>
  );
}
