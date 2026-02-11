"use client";

import { signIn } from "next-auth/react";
import Button from "@mui/material/Button";
import GoogleIcon from "@mui/icons-material/Google";

const features = [
  {
    icon: "👥",
    title: "Groups",
    description: "Create groups for trips, home, work, or anything else.",
  },
  {
    icon: "💸",
    title: "Smart Split",
    description: "Equal, percentage, shares, or exact — split any way you want.",
  },
  {
    icon: "💰",
    title: "Settle Up",
    description: "Minimize transactions with smart debt simplification.",
  },
  {
    icon: "📊",
    title: "Dashboard",
    description: "Filter and search expenses by date, tags, categories, and more.",
  },
  {
    icon: "🔄",
    title: "Real-time Sync",
    description: "Instant updates when anyone adds or edits an expense.",
  },
  {
    icon: "💱",
    title: "Multi-Currency",
    description: "Set default + 2 alternate currencies per group for easy selection.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <span className="text-xl font-bold text-gray-900">SplitWise</span>
        </div>
        <Button
          variant="outlined"
          size="small"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          sx={{ borderColor: "#6C63FF", color: "#6C63FF" }}
        >
          Sign In
        </Button>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 py-20 max-w-3xl mx-auto">
        <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
          Split expenses with friends,{" "}
          <span className="text-[#6C63FF]">the smart way.</span>
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
          Track group expenses, settle debts with minimal transactions, and
          never argue about money again.
        </p>
        <Button
          variant="contained"
          size="large"
          startIcon={<GoogleIcon />}
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          sx={{
            backgroundColor: "#6C63FF",
            "&:hover": { backgroundColor: "#5A52D5" },
            fontSize: "1.1rem",
            padding: "12px 32px",
          }}
        >
          Sign in with Google
        </Button>
      </section>

      {/* Features Grid */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              <span className="text-4xl mb-4 block">{feature.icon}</span>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center py-8 text-gray-500 text-sm">
        Built with ❤️ · SplitWise Clone
      </footer>
    </div>
  );
}

