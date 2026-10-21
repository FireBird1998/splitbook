import { z } from 'zod';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  failedRead,
  routeIds,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
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
      if (!(await groupService.isMember(id, user.id))) response = forbidden();
      else {
        const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        response = parsed.success
          ? success(await readRateSuggestion(parsed.data.from, parsed.data.to))
          : validationError(parsed.error);
      }
    }
  } catch (err) {
    response = failedRead(err, req);
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
