"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import LogoutIcon from "@mui/icons-material/Logout";
import { CURRENCIES } from "@/lib/utils/currency";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [preferredCurrency, setPreferredCurrency] = useState("INR");
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const res = await fetch("/api/user/profile");
      const data = await res.json();
      if (data.data) {
        setName(data.data.name || "");
        setPreferredCurrency(data.data.preferredCurrency || "INR");
      }
    }
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, preferredCurrency }),
      });

      if (res.ok) {
        setSnackbar("Settings saved!");
      }
    } catch {
      setSnackbar("Failed to save settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Profile */}
      <div className="bg-white rounded-xl p-6 border border-gray-100 space-y-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Profile</h2>

        <div className="flex items-center gap-4">
          <Avatar
            src={session?.user?.image || undefined}
            alt={session?.user?.name || "User"}
            sx={{ width: 64, height: 64 }}
          />
          <div>
            <p className="font-medium text-gray-900">{session?.user?.name}</p>
            <p className="text-sm text-gray-500">{session?.user?.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <TextField
            select
            label="Preferred Currency"
            value={preferredCurrency}
            onChange={(e) => setPreferredCurrency(e.target.value)}
            fullWidth
            helperText="Used as default when creating new groups"
          >
            {CURRENCIES.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.name}
              </MenuItem>
            ))}
          </TextField>

          <Button
            variant="contained"
            onClick={handleSave}
            disabled={loading}
            sx={{
              backgroundColor: "#6C63FF",
              "&:hover": { backgroundColor: "#5A52D5" },
            }}
          >
            {loading ? <CircularProgress size={20} /> : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Account */}
      <div className="bg-white rounded-xl p-6 border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Account</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Connected with Google</p>
            <p className="text-xs text-gray-400">{session?.user?.email}</p>
          </div>
          <span className="text-green-600 text-sm">✓ Connected</span>
        </div>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          Sign Out
        </Button>
      </div>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </div>
  );
}
