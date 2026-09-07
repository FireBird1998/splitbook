import { describe, expect, it } from 'vitest';
import { checkStyles } from './style-policy';

describe('adopted UI style policy', () => {
  it('checks theme construction as well as JSX style contexts', () => {
    expect(
      checkStyles(
        `createTheme({components:{MuiButton:{styleOverrides:{root:{color:'#fff',backgroundColor:'error.lighter'}}}}})`,
      ).map((finding) => finding.message),
    ).toEqual(['Use a semantic color instead of: #fff', 'Unknown palette token: error.lighter']);
    expect(
      checkStyles(
        `createTheme({palette:{primary:{main:tokens.brand.main}},components:{MuiButton:{styleOverrides:{root:{color:tokens.text}}}}})`,
      ),
    ).toEqual([]);
  });
  it('rejects unsupported palette paths and literal style colors, not user content', () => {
    const findings = checkStyles(`
      const label = '#123456';
      const screen = <Box sx={{ bgcolor: 'error.lighter', color: '#fff' }}>{label}</Box>;
    `);
    expect(findings.map((finding) => finding.message)).toEqual([
      'Unknown palette token: error.lighter',
      'Use a semantic color instead of: #fff',
    ]);
  });
  it('checks static theme access while accepting supported tokens and responsive layout', () => {
    expect(
      checkStyles(
        `<Box sx={{ p: { xs: 2, sm: 3 }, color: 'status.positive', bgcolor: 'tint.positive' }} />`,
      ),
    ).toEqual([]);
    expect(
      checkStyles(`<Box sx={{ color: (theme) => theme.palette.error.lighter }} />`).map(
        (finding) => finding.message,
      ),
    ).toEqual(['Unknown palette token: error.lighter']);
  });
});
