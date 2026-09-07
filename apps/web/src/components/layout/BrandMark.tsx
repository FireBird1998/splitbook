import Box from '@mui/material/Box';

interface BrandMarkProps {
  size?: number;
  fontSize?: number;
}

/** Indigo brand tile — the quiet counterpart to the trip-strip signature. */
export default function BrandMark({ size = 28, fontSize = 13 }: BrandMarkProps) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        width: size,
        height: size,
        borderRadius: '8px',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        display: 'grid',
        placeItems: 'center',
        fontSize,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      S
    </Box>
  );
}
