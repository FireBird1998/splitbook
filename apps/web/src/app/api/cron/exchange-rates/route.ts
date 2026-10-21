import { createRefreshHandler } from '@/lib/rates/cron';
import { createRateProviders } from '@/lib/rates/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createRefreshHandler(createRateProviders());
