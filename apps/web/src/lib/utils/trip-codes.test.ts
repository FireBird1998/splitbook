import { describe, expect, it } from 'vitest';
import { deriveTripCodes } from './trip-codes';

describe('deriveTripCodes', () => {
  it('uses the first and last word for multi-word trips', () => {
    expect(deriveTripCodes('Goa Friends Trip')).toEqual({ from: 'GOA', to: 'TRI' });
    expect(deriveTripCodes('Manali Snow Trek')).toEqual({ from: 'MAN', to: 'TRE' });
  });

  it('flows into the next word when the first word is short', () => {
    expect(deriveTripCodes('SF Layover')).toEqual({ from: 'SFL', to: 'LAY' });
  });

  it('pads short codes deterministically', () => {
    expect(deriveTripCodes('Goa NY')).toEqual({ from: 'GOA', to: 'NYX' });
  });

  it('uses the word tail for long single-word trips', () => {
    expect(deriveTripCodes('Weekend')).toEqual({ from: 'WEE', to: 'END' });
  });

  it('falls back to TRP for short single-word or empty names', () => {
    expect(deriveTripCodes('Home')).toEqual({ from: 'HOM', to: 'TRP' });
    expect(deriveTripCodes('')).toEqual({ from: 'TRP', to: 'TRP' });
    expect(deriveTripCodes('   ')).toEqual({ from: 'TRP', to: 'TRP' });
  });

  it('strips punctuation and keeps digits', () => {
    expect(deriveTripCodes('Goa 2026!')).toEqual({ from: 'GOA', to: '202' });
  });
});
