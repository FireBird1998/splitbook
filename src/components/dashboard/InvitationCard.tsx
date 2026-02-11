"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

interface InvitationCardProps {
  invitation: Record<string, unknown>;
  onAction: () => void;
}

export default function InvitationCard({ invitation, onAction }: InvitationCardProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const group = invitation.group as Record<string, unknown>;
  const invitedBy = invitation.invitedBy as Record<string, unknown>;

  const handleAction = async (action: "accept" | "decline") => {
    setLoading(action);
    try {
      await fetch(`/api/invitations/${invitation._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      onAction();
    } catch {
      console.error("Failed to process invitation");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-900">
          You&apos;ve been invited to <strong>{group?.name as string}</strong>
        </p>
        <p className="text-xs text-gray-500">
          Invited by {invitedBy?.name as string}
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button
          size="small"
          variant="contained"
          disabled={!!loading}
          onClick={() => handleAction("accept")}
          sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" } }}
        >
          {loading === "accept" ? <CircularProgress size={16} /> : "Accept"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!!loading}
          onClick={() => handleAction("decline")}
          color="inherit"
        >
          {loading === "decline" ? <CircularProgress size={16} /> : "Decline"}
        </Button>
      </div>
    </div>
  );
}

