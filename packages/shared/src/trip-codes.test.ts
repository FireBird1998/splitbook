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

  // #885: "Kraków" split at its ó into KRAK and W, and read WXX.
  it('reads an accented letter as its plain letter', () => {
    expect(deriveTripCodes('Kraków')).toEqual({ from: 'KRA', to: 'KOW' });
    expect(deriveTripCodes('São Paulo')).toEqual({ from: 'SAO', to: 'PAU' });
    expect(deriveTripCodes('Zürich')).toEqual({ from: 'ZUR', to: 'ICH' });
    expect(deriveTripCodes('Kraków and Gdańsk')).toEqual({ from: 'KRA', to: 'GDA' });
  });

  // The Designer's check of #885: letters with no accent to strip had still split names.
  it('reads a letter that has no accent to strip as the plain letters it is written with', () => {
    for (const [name, codes] of [
      ['Wrocław', { from: 'WRO', to: 'LAW' }],
      ['Łódź', { from: 'LOD', to: 'TRP' }],
      ['Białystok', { from: 'BIA', to: 'TOK' }],
      ['Ærø', { from: 'AER', to: 'TRP' }],
      ['Tromsø', { from: 'TRO', to: 'MSO' }],
      ['Großglockner', { from: 'GRO', to: 'NER' }],
      ['Đà Nẵng', { from: 'DAN', to: 'NAN' }],
      ['Þingvellir', { from: 'THI', to: 'LIR' }],
      ['Reykjavík Œuvre', { from: 'REY', to: 'OEU' }],
      ['Fjörð', { from: 'FJO', to: 'TRP' }],
    ] as const)
      expect(deriveTripCodes(name), name).toEqual(codes);
  });

  it('keeps the codes of names without accents', () => {
    for (const [name, codes] of [
      ['Goa Friends Trip', { from: 'GOA', to: 'TRI' }],
      ['SF Layover', { from: 'SFL', to: 'LAY' }],
      ['Weekend', { from: 'WEE', to: 'END' }],
      ['Krakow and Gdansk', { from: 'KRA', to: 'GDA' }],
      ['Goa 2026!', { from: 'GOA', to: '202' }],
    ] as const)
      expect(deriveTripCodes(name), name).toEqual(codes);
  });
});
