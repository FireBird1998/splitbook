"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
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
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Typography component="span" sx={{ fontSize: "3rem" }}>😕</Typography>
          <Typography variant="h6" fontWeight={700} color="text.primary">
            Oops!
          </Typography>
          <Typography color="text.secondary">{error}</Typography>
          <Button variant="outlined" onClick={() => router.push("/")}>
            Go Home
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          textAlign: "center",
          p: 4,
          borderRadius: 4,
          maxWidth: 384,
          mx: 2,
        }}
      >
        <Stack spacing={3}>
          <Typography component="span" sx={{ fontSize: "3rem" }}>💰</Typography>
          <Box>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              You&apos;ve been invited to join:
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
              <Typography variant="h6" fontWeight={700} color="text.primary">
                {CATEGORY_ICONS[(group?.category as string) || "other"]}{" "}
                {group?.name as string}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {group?.memberCount as number} member{(group?.memberCount as number) !== 1 ? "s" : ""}
            </Typography>
          </Box>

          {status === "authenticated" ? (
            <Button
              variant="contained"
              fullWidth
              onClick={handleJoin}
              disabled={joining}
              sx={{ py: 1.5 }}
            >
              {joining ? <CircularProgress size={20} /> : "Join Group"}
            </Button>
          ) : (
            <Button
              variant="contained"
              fullWidth
              startIcon={<GoogleIcon />}
              onClick={() => signIn("google", { callbackUrl: `/join/${code}` })}
              sx={{ py: 1.5 }}
            >
              Sign in with Google to Join
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
