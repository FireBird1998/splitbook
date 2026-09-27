import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import connectDB from '@/lib/db';
import User from '@/lib/models/User';
import { updateProfileSchema } from '@splitbook/shared/validators/profile';

// GET /api/user/profile
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    await connectDB();
    const dbUser = await User.findById(user.id).lean();
    if (!dbUser) {
      // A valid session may predate the application's profile record.
      const newUser = await User.create({
        _id: user.id,
        name: user.name || 'User',
        email: user.email || '',
        image: user.image || '',
      });
      return success(newUser);
    }

    return success(dbUser);
  } catch (err) {
    return serverError(err);
  }
}

// PATCH /api/user/profile
export async function PATCH(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    await connectDB();
    const updated = await User.findByIdAndUpdate(user.id, parsed.data, {
      returnDocument: 'after',
      runValidators: true,
    }).lean();

    return success(updated);
  } catch (err) {
    return serverError(err);
  }
}
