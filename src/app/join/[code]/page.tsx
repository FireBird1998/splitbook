"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import GoogleIcon from "@mui/icons-material/Google";

const CATEGORY_ICONS: Record<string, string> = {
  trip: "✈️",
  home: "🏠",
  couple: "💑",
  work: "💼",
  other: "📋",
};

export default function JoinGroupPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const { data: session, status } = useSession();

  const [group, setGroup] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadGroup() {
      try {
        const res = await fetch(`/api/join/${code}`);
        if (res.ok) {
          const data = await res.json();
          setGroup(data.data);
        } else {
          setError("This invite link is invalid or has expired.");
        }
      } catch {
        setError("Failed to load group information.");
      } finally {
        setLoading(false);
      }
    }
    loadGroup();
  }, [code]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      const res = await fetch(`/api/join/${code}`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        router.push(`/groups/${data.data.groupId}`);
      } else {
        setError(data.error || "Failed to join group");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <CircularProgress />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <span className="text-5xl block">😕</span>
          <h1 className="text-xl font-bold text-gray-900">Oops!</h1>
          <p className="text-gray-600">{error}</p>
          <Button variant="outlined" onClick={() => router.push("/")}>
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-6 p-8 bg-white rounded-2xl shadow-sm border border-gray-100 max-w-sm mx-4">
        <span className="text-5xl block">💰</span>
        <div>
          <p className="text-gray-500 mb-2">You&apos;ve been invited to join:</p>
          <h1 className="text-xl font-bold text-gray-900 flex items-center justify-center gap-2">
            {CATEGORY_ICONS[(group?.category as string) || "other"]}{" "}
            {group?.name as string}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {group?.memberCount as number} member{(group?.memberCount as number) !== 1 ? "s" : ""}
          </p>
        </div>

        {status === "authenticated" ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleJoin}
            disabled={joining}
            sx={{
              backgroundColor: "#6C63FF",
              "&:hover": { backgroundColor: "#5A52D5" },
              padding: "12px",
            }}
          >
            {joining ? <CircularProgress size={20} /> : "Join Group"}
          </Button>
        ) : (
          <Button
            variant="contained"
            fullWidth
            startIcon={<GoogleIcon />}
            onClick={() => signIn("google", { callbackUrl: `/join/${code}` })}
            sx={{
              backgroundColor: "#6C63FF",
              "&:hover": { backgroundColor: "#5A52D5" },
              padding: "12px",
            }}
          >
            Sign in with Google to Join
          </Button>
        )}
      </div>
    </div>
  );
}

