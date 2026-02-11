"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import Snackbar from "@mui/material/Snackbar";

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
}

export default function InviteDialog({ open, onClose, groupId }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");

  const [inviteLink, setInviteLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snackbar, setSnackbar] = useState("");

  const handleEmailInvite = async () => {
    if (!email.trim()) return;
    setEmailLoading(true);
    setEmailError("");

    try {
      const res = await fetch(`/api/groups/${groupId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEmailError(data.error || "Failed to send invite");
        return;
      }

      setEmailSent(true);
      setEmail("");
      setSnackbar("Invitation sent!");
    } catch {
      setEmailError("Something went wrong.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGenerateLink = async () => {
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invite-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 7 }),
      });

      const data = await res.json();
      if (res.ok) {
        setInviteLink(data.data.inviteUrl);
      }
    } catch {
      console.error("Failed to generate link");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setSnackbar("Link copied!");
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Invite Members
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          <div className="space-y-4 pt-2">
            {/* Email Invite */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Invite by email
              </label>
              {emailError && (
                <p className="text-red-500 text-xs mb-2">{emailError}</p>
              )}
              {emailSent && (
                <p className="text-green-600 text-xs mb-2 flex items-center gap-1">
                  <CheckIcon fontSize="small" /> Invitation sent!
                </p>
              )}
              <div className="flex gap-2">
                <TextField
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailSent(false);
                  }}
                  placeholder="friend@gmail.com"
                  size="small"
                  fullWidth
                  type="email"
                />
                <Button
                  variant="contained"
                  onClick={handleEmailInvite}
                  disabled={emailLoading || !email.trim()}
                  sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" }, flexShrink: 0 }}
                >
                  {emailLoading ? <CircularProgress size={20} /> : "Send"}
                </Button>
              </div>
            </div>

            <Divider>
              <span className="text-xs text-gray-400">OR</span>
            </Divider>

            {/* Invite Link */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Share invite link
              </label>
              {inviteLink ? (
                <div className="flex gap-2">
                  <TextField
                    value={inviteLink}
                    size="small"
                    fullWidth
                    slotProps={{ input: { readOnly: true } }}
                    sx={{ "& input": { fontSize: 12 } }}
                  />
                  <IconButton onClick={handleCopy} size="small" color={copied ? "success" : "default"}>
                    {copied ? <CheckIcon /> : <ContentCopyIcon />}
                  </IconButton>
                </div>
              ) : (
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleGenerateLink}
                  disabled={linkLoading}
                  sx={{ borderColor: "#6C63FF", color: "#6C63FF" }}
                >
                  {linkLoading ? <CircularProgress size={20} /> : "Generate Invite Link"}
                </Button>
              )}
              {inviteLink && (
                <p className="text-xs text-gray-400 mt-1">Expires in 7 days</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </>
  );
}

