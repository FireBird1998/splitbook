import { error, getAuthUser, serverError, success, unauthorized } from '@/lib/utils/api-response';
import { emptySearch, searchService } from '@/lib/services/search.service';
import { normalizeSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@splitbook/shared/search';

// GET /api/search?q= — Search the member's own Groups, the people in them and their Expenses (#321)
export async function GET(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const query = normalizeSearchQuery(new URL(req.url).searchParams.get('q') ?? '');
    if (query === '') return success(emptySearch());
    if (query.length > SEARCH_QUERY_MAX_LENGTH)
      return error(
        `Search for at most ${SEARCH_QUERY_MAX_LENGTH} characters.`,
        422,
        'QUERY_TOO_LONG',
      );

    return success(await searchService.search(user.id, query));
  } catch (err) {
    return serverError(err);
  }
}
