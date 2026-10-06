'use client';

import Image from 'next/image';
import { useTheme } from '@mui/material/styles';
import { PRODUCT_NAME } from '@/lib/product';

/** The mark's square artwork (public/brand/mark-*.svg). */
const MARK_SIZE = 512;

/** The brand standard's smallest mark; below it, use the favicon or omit the brand. */
export const BRAND_MARK_MIN_SIZE = 16;

interface BrandMarkProps {
  /** Displayed size in CSS px: 24, 32, 40 or 48 in the brand standard; never below 16. */
  size?: number;
  /**
   * Decorative by default, for a mark beside the visible name. A mark standing alone
   * passes false and is named "Splitbook".
   */
  decorative?: boolean;
}

/** The Splitbook mark: indigo, or the on-dark indigo on a dark theme. */
export default function BrandMark({ size = 24, decorative = true }: BrandMarkProps) {
  const dark = useTheme().palette.mode === 'dark';
  const displayed = Math.max(BRAND_MARK_MIN_SIZE, size);

  return (
    <Image
      src={dark ? '/brand/mark-on-dark.svg' : '/brand/mark-indigo.svg'}
      alt={decorative ? '' : PRODUCT_NAME}
      width={MARK_SIZE}
      height={MARK_SIZE}
      loading="eager"
      style={{
        display: 'block',
        width: displayed,
        height: displayed,
        flexShrink: 0,
        objectFit: 'contain',
      }}
    />
  );
}
