"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Button from "@mui/material/Button";
import GoogleIcon from "@mui/icons-material/Google";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-8 p-8">
        <div>
          <span className="text-5xl mb-4 block">💰</span>
          <h1 className="text-3xl font-bold text-gray-900">SplitWise</h1>
        </div>

        <div>
          <h2 className="text-xl text-gray-700 mb-2">Welcome back!</h2>
          <p className="text-gray-500">Sign in to continue.</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            Something went wrong. Please try again.
          </div>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<GoogleIcon />}
          onClick={() => signIn("google", { callbackUrl })}
          sx={{
            backgroundColor: "#6C63FF",
            "&:hover": { backgroundColor: "#5A52D5" },
            fontSize: "1rem",
            padding: "12px 24px",
            maxWidth: 320,
          }}
        >
          Sign in with Google
        </Button>

        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <span className="text-5xl mb-4 block">💰</span>
            <p className="text-gray-500">Loading...</p>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

