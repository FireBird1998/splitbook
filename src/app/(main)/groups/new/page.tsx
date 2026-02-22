"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import Autocomplete from "@mui/material/Autocomplete";
import { alpha } from "@mui/material/styles";
import { CURRENCIES } from "@/lib/utils/currency";

const CATEGORIES = [
  { id: "trip", label: "Trip", icon: "✈️" },
  { id: "home", label: "Home", icon: "🏠" },
  { id: "couple", label: "Couple", icon: "💑" },
  { id: "work", label: "Work", icon: "💼" },
  { id: "other", label: "Other", icon: "📋" },
];

export default function NewGroupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [defaultCurrency, setDefaultCurrency] = useState("INR");
  const [alternateCurrencies, setAlternateCurrencies] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          category,
          defaultCurrency,
          alternateCurrencies,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create group");
        return;
      }

      router.push(`/groups/${data.data._id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" disableGutters>
      <Typography variant="h5" fontWeight={700} color="text.primary" sx={{ mb: 3 }}>
        Create Group
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack component="form" onSubmit={handleSubmit} spacing={3}>
          {error && (
            <Box
              sx={{
                bgcolor: (theme) => `${theme.palette.error.main}12`,
                color: "error.main",
                px: 2,
                py: 1.5,
                borderRadius: 2,
                fontSize: "0.875rem",
              }}
            >
              {error}
            </Box>
          )}

          <TextField
            label="Group Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            placeholder="e.g. Europe Trip 2026"
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <TextField
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder="What is this group for?"
          />

          {/* Category */}
          <Box>
            <Typography variant="body2" fontWeight={500} color="text.secondary" sx={{ mb: 1 }}>
              Category
            </Typography>
            <ToggleButtonGroup
              value={category}
              exclusive
              onChange={(_, val) => val && setCategory(val)}
              size="small"
              sx={{ flexWrap: "wrap", gap: 1 }}
            >
              {CATEGORIES.map((cat) => (
                <ToggleButton
                  key={cat.id}
                  value={cat.id}
                  sx={{
                    borderRadius: "8px !important",
                    border: "1px solid",
                    borderColor: "divider",
                    textTransform: "none",
                    "&.Mui-selected": {
                      backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
                      color: "primary.main",
                      borderColor: "primary.main",
                    },
                  }}
                >
                  {cat.icon} {cat.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {/* Default Currency */}
          <TextField
            select
            label="Default Currency"
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            fullWidth
            required
          >
            {CURRENCIES.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.name}
              </MenuItem>
            ))}
          </TextField>

          {/* Alternate Currencies */}
          <Autocomplete
            multiple
            options={CURRENCIES.filter((c) => c.code !== defaultCurrency).map((c) => c.code)}
            value={alternateCurrencies}
            onChange={(_, val) => setAlternateCurrencies(val.slice(0, 2))}
            getOptionLabel={(code) => {
              const c = CURRENCIES.find((cur) => cur.code === code);
              return c ? `${c.flag} ${c.code} — ${c.name}` : code;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Alternate Currencies (max 2)"
                placeholder="Select currencies..."
              />
            )}
            disableCloseOnSelect
            limitTags={2}
          />

          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ pt: 1 }}>
            <Button
              variant="outlined"
              onClick={() => router.back()}
              color="inherit"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !name.trim()}
            >
              {loading ? <CircularProgress size={20} /> : "Create Group"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
