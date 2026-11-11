import { readGroupLedger } from '@/lib/group-ledger-read';
import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { z } from 'zod';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import {
  getAuthUser,
  unauthorized,
  success,
  failedRead,
  routeIds,
  validationError,
} from '@/lib/utils/api-response';
import { readRateSuggestion } from '@/lib/rates/service';

const currency = z.string().refine((code) => CURRENCY_CODES.includes(code), 'Unsupported currency');
const query = z.object({ from: currency, to: currency });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let response: Response;
  try {
    const user = await getAuthUser();
    if (!user) response = unauthorized();
    else {
      const { id } = await routeIds(params);
      response = await readGroupLedger({
        actor: { kind: 'member', id: user.id },
        groupId: id,
        recurring: 'recorded-only',
        deletionMarker: 'allow-retained-members',
        read: async () => {
          const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
          return parsed.success
            ? success(await readRateSuggestion(parsed.data.from, parsed.data.to))
            : validationError(parsed.error);
        },
      });
    }
  } catch (err) {
    response = failedRead(err, req);
  }
  response.headers.set('Cache-Control', API_CACHE_CONTROL);
  return response;
}
