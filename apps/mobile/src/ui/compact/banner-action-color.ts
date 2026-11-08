import { createContext } from 'react';

/** Text actions inherit a Banner's status colour; outside it (or offline), they keep brand. */
export const BannerActionColor = createContext<string | null>(null);
