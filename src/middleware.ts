import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

/**
 * Middleware uses the edge-compatible auth config (no MongoDB adapter).
 * The `authorized` callback in auth.config.ts handles all route protection logic.
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
