"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Avatar from "@mui/material/Avatar";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import PersonIcon from "@mui/icons-material/Person";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import DeleteIcon from "@mui/icons-material/Delete";
import LabelIcon from "@mui/icons-material/Label";
import { CURRENCIES, getSortedCurrencies } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const GROUP_CATEGORIES = [
  { id: "trip", label: "✈️ Trip" },
  { id: "home", label: "🏠 Home" },
  { id: "couple", label: "💑 Couple" },
  { id: "work", label: "💼 Work" },
  { id: "other", label: "📋 Other" },
];

interface GroupSettingsViewProps {
  groupId: string;
  userId: string;
}

export default function GroupSettingsView({ groupId, userId }: GroupSettingsViewProps) {
  const { mutate: globalMutate } = useSWRConfig();
  const { data: groupData, isLoading, mutate } = useSWR(
    `/api/groups/${groupId}`,
    fetcher
  );

  const group = groupData?.data;

  // General info form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalInitialized, setGeneralInitialized] = useState(false);

  // Currency form
  const [defaultCurrency, setDefaultCurrency] = useState("");
  const [alternateCurrencies, setAlternateCurrencies] = useState<string[]>([]);
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyInitialized, setCurrencyInitialized] = useState(false);

  // Member menu
  const [memberMenuAnchor, setMemberMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);

  // Invite link
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false);

  // Tag management
  const [newTagName, setNewTagName] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [tagMenuAnchor, setTagMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [deleteTagDialogOpen, setDeleteTagDialogOpen] = useState(false);
  const [deleteTagError, setDeleteTagError] = useState("");

  // Archive dialog
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // Snackbar
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });

  // Initialize form values from group data
  if (group && !generalInitialized) {
    setName(group.name || "");
    setDescription(group.description || "");
    setCategory(group.category || "other");
    setGeneralInitialized(true);
  }

  if (group && !currencyInitialized) {
    setDefaultCurrency(group.defaultCurrency || "INR");
    setAlternateCurrencies(group.alternateCurrencies || []);
    setCurrencyInitialized(true);
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded mb-4" />
        <div className="h-4 w-32 bg-gray-200 rounded mb-8" />
        <div className="h-96 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <h2 className="text-xl font-medium text-gray-900 mb-2">Group not found</h2>
        <p className="text-gray-500">This group may have been deleted or you don&apos;t have access.</p>
      </div>
    );
  }

  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; email?: string; image?: string };
    role: string;
    joinedAt: string;
  }>;

  const currentUserMember = members.find((m) => m.user._id === userId);
  const isAdmin = currentUserMember?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <h2 className="text-xl font-medium text-gray-900 mb-2">Access denied</h2>
        <p className="text-gray-500 mb-4">Only group admins can access settings.</p>
        <Button component={Link} href={`/groups/${groupId}`} variant="outlined">
          Back to Group
        </Button>
      </div>
    );
  }

  const currencies = getSortedCurrencies(
    group.defaultCurrency,
    group.alternateCurrencies || []
  );

  // Handlers
  const handleSaveGeneral = async () => {
    setGeneralSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, category }),
      });
      if (res.ok) {
        mutate();
        globalMutate((key: unknown) => typeof key === "string" && key.includes("/api/groups"));
        setSnackbar({ open: true, message: "Group info updated" });
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to update" });
    } finally {
      setGeneralSaving(false);
    }
  };

  const handleSaveCurrency = async () => {
    setCurrencySaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCurrency, alternateCurrencies }),
      });
      if (res.ok) {
        mutate();
        setSnackbar({ open: true, message: "Currency settings updated" });
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to update" });
    } finally {
      setCurrencySaving(false);
    }
  };

  const handleMemberAction = async (action: "promote" | "demote" | "remove") => {
    if (!selectedMember) return;
    setMemberLoading(true);
    try {
      if (action === "remove") {
        await fetch(`/api/groups/${groupId}/members/${selectedMember}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/groups/${groupId}/members/${selectedMember}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: action === "promote" ? "admin" : "member",
          }),
        });
      }
      mutate();
      setSnackbar({
        open: true,
        message:
          action === "remove"
            ? "Member removed"
            : action === "promote"
            ? "Promoted to admin"
            : "Demoted to member",
      });
    } catch {
      setSnackbar({ open: true, message: "Action failed" });
    } finally {
      setMemberLoading(false);
      setMemberMenuAnchor(null);
      setSelectedMember(null);
    }
  };

  const handleGenerateInviteLink = async () => {
    setInviteLinkLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invite-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 7 }),
      });
      const data = await res.json();
      if (data.data?.inviteUrl) {
        setInviteLink(data.data.inviteUrl);
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to generate link" });
    } finally {
      setInviteLinkLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setSnackbar({ open: true, message: "Link copied to clipboard" });
    }
  };

  const handleArchive = async () => {
    setArchiveLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/groups";
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to archive group" });
    } finally {
      setArchiveLoading(false);
    }
  };

  // ─── Tag Handlers ──────────────────────────────────
  const tags = (group.tags || []) as Array<{
    _id: string;
    name: string;
    isArchived: boolean;
    createdAt: string;
  }>;

  const selectedTagData = tags.find((t) => t._id === selectedTag);

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    setTagLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSnackbar({ open: true, message: data.error || "Failed to create tag" });
      } else {
        setNewTagName("");
        mutate();
        setSnackbar({ open: true, message: "Tag created" });
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to create tag" });
    } finally {
      setTagLoading(false);
    }
  };

  const handleToggleArchiveTag = async () => {
    if (!selectedTag || !selectedTagData) return;
    setTagLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/tags/${selectedTag}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: !selectedTagData.isArchived }),
      });
      if (res.ok) {
        mutate();
        setSnackbar({
          open: true,
          message: selectedTagData.isArchived ? "Tag unarchived" : "Tag archived",
        });
      }
    } catch {
      setSnackbar({ open: true, message: "Failed to update tag" });
    } finally {
      setTagLoading(false);
      setTagMenuAnchor(null);
      setSelectedTag(null);
    }
  };

  const handleDeleteTag = async () => {
    if (!selectedTag) return;
    setTagLoading(true);
    setDeleteTagError("");
    try {
      const res = await fetch(`/api/groups/${groupId}/tags/${selectedTag}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteTagError(data.error || "Failed to delete tag");
      } else {
        mutate();
        setSnackbar({ open: true, message: "Tag deleted" });
        setDeleteTagDialogOpen(false);
        setTagMenuAnchor(null);
        setSelectedTag(null);
      }
    } catch {
      setDeleteTagError("Failed to delete tag");
    } finally {
      setTagLoading(false);
    }
  };

  const selectedMemberData = members.find((m) => m.user._id === selectedMember);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <IconButton component={Link} href={`/groups/${groupId}`} size="small">
          <ArrowBackIcon />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Group Settings</h1>
          <p className="text-sm text-gray-500">{group.name}</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* ─── General Information ──────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">General Information</h2>
          <div className="space-y-4">
            <TextField
              label="Group Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
            <TextField
              select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              fullWidth
              size="small"
            >
              {GROUP_CATEGORIES.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
            <div className="flex justify-end">
              <Button
                variant="contained"
                onClick={handleSaveGeneral}
                disabled={generalSaving || !name.trim()}
                sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" }, textTransform: "none" }}
              >
                {generalSaving ? <CircularProgress size={20} /> : "Save Changes"}
              </Button>
            </div>
          </div>
        </section>

        {/* ─── Currency Settings ───────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Currency Settings</h2>
          <div className="space-y-4">
            <TextField
              select
              label="Default Currency"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              fullWidth
              size="small"
            >
              {currencies.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.name}
                </MenuItem>
              ))}
            </TextField>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Alternate Currencies (max 2)
              </label>
              <div className="flex gap-2 flex-wrap mb-2">
                {alternateCurrencies.map((code) => {
                  const curr = CURRENCIES.find((c) => c.code === code);
                  return (
                    <Chip
                      key={code}
                      label={`${curr?.flag || ""} ${code}`}
                      onDelete={() =>
                        setAlternateCurrencies(alternateCurrencies.filter((c) => c !== code))
                      }
                      size="small"
                    />
                  );
                })}
              </div>
              {alternateCurrencies.length < 2 && (
                <TextField
                  select
                  label="Add currency"
                  value=""
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !alternateCurrencies.includes(e.target.value) &&
                      e.target.value !== defaultCurrency
                    ) {
                      setAlternateCurrencies([...alternateCurrencies, e.target.value]);
                    }
                  }}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="" disabled>
                    Select currency...
                  </MenuItem>
                  {CURRENCIES.filter(
                    (c) => c.code !== defaultCurrency && !alternateCurrencies.includes(c.code)
                  ).map((c) => (
                    <MenuItem key={c.code} value={c.code}>
                      {c.flag} {c.code} — {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                variant="contained"
                onClick={handleSaveCurrency}
                disabled={currencySaving}
                sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" }, textTransform: "none" }}
              >
                {currencySaving ? <CircularProgress size={20} /> : "Save Currency"}
              </Button>
            </div>
          </div>
        </section>

        {/* ─── Tags ─────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tags</h2>
          <p className="text-sm text-gray-500 mb-4">
            Every expense must have exactly one tag. Archived tags won&apos;t appear in the expense form.
          </p>

          {/* Add tag */}
          <div className="flex gap-2 mb-4">
            <TextField
              placeholder="New tag name..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              size="small"
              fullWidth
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
              }}
              slotProps={{ htmlInput: { maxLength: 50 } }}
            />
            <Button
              variant="contained"
              onClick={handleAddTag}
              disabled={tagLoading || !newTagName.trim()}
              startIcon={<AddIcon />}
              sx={{
                backgroundColor: "#6C63FF",
                "&:hover": { backgroundColor: "#5A52D5" },
                textTransform: "none",
                minWidth: 100,
              }}
            >
              Add
            </Button>
          </div>

          {/* Tag list */}
          {tags.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              <LabelIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
              <p className="text-sm">No tags yet. Create your first tag above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tags.map((tag) => (
                <div
                  key={tag._id}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                    tag.isArchived ? "bg-gray-50 opacity-70" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <LabelIcon
                      fontSize="small"
                      sx={{ color: tag.isArchived ? "gray" : "#6C63FF" }}
                    />
                    <span
                      className={`text-sm font-medium ${
                        tag.isArchived ? "text-gray-400 line-through" : "text-gray-900"
                      }`}
                    >
                      {tag.name}
                    </span>
                    {tag.isArchived && (
                      <Chip
                        label="Archived"
                        size="small"
                        sx={{ fontSize: 10, height: 20, backgroundColor: "rgba(0,0,0,0.06)" }}
                      />
                    )}
                  </div>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setSelectedTag(tag._id);
                      setTagMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          {/* Tag action menu */}
          <Menu
            anchorEl={tagMenuAnchor}
            open={!!tagMenuAnchor}
            onClose={() => {
              setTagMenuAnchor(null);
              setSelectedTag(null);
            }}
            slotProps={{ paper: { sx: { minWidth: 180 } } }}
          >
            <MuiMenuItem
              onClick={handleToggleArchiveTag}
              disabled={tagLoading}
            >
              <ListItemIcon>
                {selectedTagData?.isArchived ? (
                  <UnarchiveIcon fontSize="small" />
                ) : (
                  <ArchiveIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>
                {selectedTagData?.isArchived ? "Unarchive" : "Archive"}
              </ListItemText>
            </MuiMenuItem>
            <MuiMenuItem
              onClick={() => {
                setDeleteTagError("");
                setDeleteTagDialogOpen(true);
                setTagMenuAnchor(null);
              }}
              disabled={tagLoading}
            >
              <ListItemIcon>
                <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
              </ListItemIcon>
              <ListItemText sx={{ color: "error.main" }}>Delete</ListItemText>
            </MuiMenuItem>
          </Menu>
        </section>

        {/* Delete Tag Confirmation Dialog */}
        <Dialog
          open={deleteTagDialogOpen}
          onClose={() => {
            setDeleteTagDialogOpen(false);
            setSelectedTag(null);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Delete Tag</DialogTitle>
          <DialogContent>
            <p className="text-sm text-gray-700">
              Are you sure you want to delete the tag{" "}
              <strong>&ldquo;{selectedTagData?.name}&rdquo;</strong>?
              This is only possible if no expenses use this tag.
            </p>
            {deleteTagError && (
              <p className="text-sm text-red-500 mt-2">{deleteTagError}</p>
            )}
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button
              onClick={() => {
                setDeleteTagDialogOpen(false);
                setSelectedTag(null);
              }}
              color="inherit"
              disabled={tagLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteTag}
              variant="contained"
              color="error"
              disabled={tagLoading}
            >
              {tagLoading ? <CircularProgress size={20} /> : "Delete"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ─── Members ─────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Members ({members.length})
          </h2>
          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.user._id}
                className="flex items-center justify-between py-2"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    src={m.user.image}
                    sx={{ width: 36, height: 36, fontSize: 14 }}
                  >
                    {m.user.name?.[0]}
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {m.user._id === userId ? "You" : m.user.name}
                      </span>
                      <Chip
                        label={m.role}
                        size="small"
                        sx={{
                          fontSize: 10,
                          height: 20,
                          ...(m.role === "admin"
                            ? { backgroundColor: "rgba(108,99,255,0.1)", color: "#6C63FF" }
                            : {}),
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-400">
                      {m.user.email} · Joined {formatDate(m.joinedAt)}
                    </p>
                  </div>
                </div>

                {m.user._id !== userId && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setSelectedMember(m.user._id);
                      setMemberMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )}
              </div>
            ))}
          </div>

          {/* Member action menu */}
          <Menu
            anchorEl={memberMenuAnchor}
            open={!!memberMenuAnchor}
            onClose={() => {
              setMemberMenuAnchor(null);
              setSelectedMember(null);
            }}
            slotProps={{ paper: { sx: { minWidth: 180 } } }}
          >
            {selectedMemberData?.role === "member" && (
              <MuiMenuItem
                onClick={() => handleMemberAction("promote")}
                disabled={memberLoading}
              >
                <ListItemIcon>
                  <AdminPanelSettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Promote to Admin</ListItemText>
              </MuiMenuItem>
            )}
            {selectedMemberData?.role === "admin" && (
              <MuiMenuItem
                onClick={() => handleMemberAction("demote")}
                disabled={memberLoading}
              >
                <ListItemIcon>
                  <PersonIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Demote to Member</ListItemText>
              </MuiMenuItem>
            )}
            <MuiMenuItem
              onClick={() => handleMemberAction("remove")}
              disabled={memberLoading}
            >
              <ListItemIcon>
                <PersonRemoveIcon fontSize="small" sx={{ color: "error.main" }} />
              </ListItemIcon>
              <ListItemText sx={{ color: "error.main" }}>Remove</ListItemText>
            </MuiMenuItem>
          </Menu>
        </section>

        {/* ─── Invite Link ─────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Invite Link</h2>
          {inviteLink ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <code className="text-sm text-gray-700 flex-1 truncate">{inviteLink}</code>
                <IconButton size="small" onClick={handleCopyLink}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </div>
              <p className="text-xs text-gray-500">Link expires in 7 days</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Generate a shareable link that anyone can use to join this group.
              </p>
              <Button
                variant="outlined"
                onClick={handleGenerateInviteLink}
                disabled={inviteLinkLoading}
                startIcon={
                  inviteLinkLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <ShareIcon />
                  )
                }
                sx={{ textTransform: "none" }}
              >
                Generate Invite Link
              </Button>
            </div>
          )}
        </section>

        {/* ─── Danger Zone ─────────────────────────── */}
        <section className="bg-white rounded-xl border-2 border-red-200 p-6">
          <h2 className="text-lg font-semibold text-red-600 mb-2">Danger Zone</h2>
          <p className="text-sm text-gray-500 mb-4">
            Archiving a group will hide it from all members. Existing expenses and settlements will be preserved.
          </p>
          <Button
            variant="outlined"
            color="error"
            onClick={() => setArchiveDialogOpen(true)}
            sx={{ textTransform: "none" }}
          >
            Archive Group
          </Button>
        </section>
      </div>

      {/* Archive Confirmation Dialog */}
      <Dialog
        open={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Archive Group</DialogTitle>
        <DialogContent>
          <p className="text-sm text-gray-700">
            Are you sure you want to archive <strong>&ldquo;{group.name}&rdquo;</strong>?
            This will hide the group from all members.
          </p>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setArchiveDialogOpen(false)}
            color="inherit"
            disabled={archiveLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleArchive}
            variant="contained"
            color="error"
            disabled={archiveLoading}
          >
            {archiveLoading ? <CircularProgress size={20} /> : "Archive"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ open: false, message: "" })}
        message={snackbar.message}
      />
    </div>
  );
}

