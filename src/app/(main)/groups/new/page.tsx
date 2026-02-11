"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import Autocomplete from "@mui/material/Autocomplete";
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
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Group</h1>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl p-6 border border-gray-100">
        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
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
                  border: "1px solid #e5e7eb !important",
                  textTransform: "none",
                  "&.Mui-selected": {
                    backgroundColor: "rgba(108,99,255,0.1)",
                    color: "#6C63FF",
                    borderColor: "#6C63FF !important",
                  },
                }}
              >
                {cat.icon} {cat.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

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

        <div className="flex justify-end gap-3 pt-2">
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
            sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" } }}
          >
            {loading ? <CircularProgress size={20} /> : "Create Group"}
          </Button>
        </div>
      </form>
    </div>
  );
}

