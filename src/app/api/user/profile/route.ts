import { getAuthUser, unauthorized, success, serverError, validationError } from "@/lib/utils/api-response";
import connectDB from "@/lib/db";
import User from "@/lib/models/User";
import { z } from "zod/v4";
import { CURRENCY_CODES } from "@/lib/utils/currency";

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  preferredCurrency: z
    .string()
    .refine((val) => CURRENCY_CODES.includes(val))
    .optional(),
});

// GET /api/user/profile
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    await connectDB();
    const dbUser = await User.findById(user.id).lean();
    if (!dbUser) {
      // User exists in Auth.js but not yet in our User model — create it
      const newUser = await User.create({
        _id: user.id,
        name: user.name || "User",
        email: user.email || "",
        image: user.image || "",
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
      new: true,
    }).lean();

    return success(updated);
  } catch (err) {
    return serverError(err);
  }
}

