/** Exact owner-approved placement and intersecting masks; the vector stage occupies the image slot. */
const heroMask =
  'linear-gradient(to bottom,transparent 0,#000 30%,#000 62%,transparent 94%),linear-gradient(to right,transparent 0,#000 20%,#000 82%,transparent 100%)';
const settleMask =
  'linear-gradient(to right,transparent 0,#000 38%),linear-gradient(to bottom,transparent 0,#000 16%,#000 80%,transparent 100%)';
const assistMask =
  'linear-gradient(to right,transparent 0,#000 36%),linear-gradient(to bottom,transparent 0,#000 12%,#000 66%,transparent 92%)';
const phoneMask =
  'linear-gradient(to bottom,transparent 0,#000 30%,#000 70%,transparent 100%),linear-gradient(to right,transparent 0,#000 16%,#000 84%,transparent 100%)';
const mask = (image: string) => ({
  maskImage: image,
  maskComposite: 'intersect',
  WebkitMaskImage: image,
  WebkitMaskComposite: 'source-in',
});
export const quietLayout = {
  '& .sbq-lift': { position: 'relative', zIndex: 1 },
  '& .sbq-hero': {
    position: 'relative',
    zIndex: 0,
    height: 'clamp(240px,40vw,600px)',
    marginTop: 'clamp(-150px,-9vw,-24px)',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  '& .sbq-hero .sbq-image': {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 'min(1720px,132%)',
    maxWidth: 'none',
    transform: 'translateX(-48%)',
    ...mask(heroMask),
  },
  '& .sbq-art': { position: 'absolute', zIndex: 0, pointerEvents: 'none' },
  '& .sbq-art .sbq-image': { display: 'block', width: '100%', height: 'auto' },
  '& .sbq-settle': {
    right: '-7%',
    top: '50%',
    width: 'min(980px,66%)',
    transform: 'translateY(-48%)',
  },
  '& .sbq-settle .sbq-image': mask(settleMask),
  '& .sbq-assist': { right: '-9%', top: 'clamp(24px,3vw,56px)', width: 'min(940px,64%)' },
  '& .sbq-assist .sbq-image': mask(assistMask),
  '& .sbq-still': { display: 'none', width: '100%', height: 'auto' },
  '@media (prefers-reduced-motion: reduce)': {
    '& .sbq-stage': { display: 'none' },
    '& .sbq-still-light': { display: 'block' },
  },
  '@media (max-width:860px)': {
    '& .sbq-art': {
      position: 'relative',
      right: 'auto',
      top: 'auto',
      transform: 'none',
      width: '124%',
      margin: '28px -12% -24px',
    },
    '& .sbq-art .sbq-image': mask(phoneMask),
  },
} as const;
