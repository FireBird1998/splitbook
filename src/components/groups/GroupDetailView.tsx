"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import IconButton from "@mui/material/IconButton";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";
import Fab from "@mui/material/Fab";
import Chip from "@mui/material/Chip";
import SettingsIcon from "@mui/icons-material/Settings";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import ShareIcon from "@mui/icons-material/Share";
import ExpenseListView from "@/components/expenses/ExpenseListView";
import BalancesView from "@/components/balances/BalancesView";
import ActivityView from "@/components/activity/ActivityView";
import ExpenseFormDialog from "@/components/expenses/ExpenseFormDialog";
import InviteDialog from "@/components/groups/InviteDialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const CATEGORY_ICONS: Record<string, string> = {
  trip: "✈️",
  home: "🏠",
  couple: "💑",
  work: "💼",
  other: "📋",
};

interface GroupDetailViewProps {
  groupId: string;
  userId: string;
}

export default function GroupDetailView({ groupId, userId }: GroupDetailViewProps) {
  const [tab, setTab] = useState(0);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const { data: groupData, isLoading } = useSWR(
    `/api/groups/${groupId}`,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const group = groupData?.data;

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded mb-4" />
        <div className="h-4 w-32 bg-gray-200 rounded mb-8" />
        <div className="h-96 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-5xl mx-auto text-center py-12">
        <h2 className="text-xl font-medium text-gray-900 mb-2">Group not found</h2>
        <p className="text-gray-500">This group may have been deleted or you don&apos;t have access.</p>
      </div>
    );
  }

  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; image?: string; email?: string };
    role: string;
  }>;
  const category = group.category as string;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <IconButton component={Link} href="/groups" size="small">
            <ArrowBackIcon />
          </IconButton>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{CATEGORY_ICONS[category] || "📋"}</span>
              <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <Chip label={category} size="small" variant="outlined" />
              <AvatarGroup
                max={5}
                sx={{ "& .MuiAvatar-root": { width: 24, height: 24, fontSize: 11 } }}
              >
                {members.map((m) => (
                  <Avatar key={m.user._id} src={m.user.image} alt={m.user.name} sx={{ width: 24, height: 24 }}>
                    {m.user.name?.[0]}
                  </Avatar>
                ))}
              </AvatarGroup>
              <span className="text-sm text-gray-500">
                {members.length} member{members.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <IconButton onClick={() => setInviteDialogOpen(true)} size="small" title="Invite">
            <ShareIcon />
          </IconButton>
          <IconButton component={Link} href={`/groups/${groupId}/settings`} size="small" title="Settings">
            <SettingsIcon />
          </IconButton>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 3,
          "& .MuiTab-root": { textTransform: "none", fontWeight: 600 },
          "& .Mui-selected": { color: "#6C63FF" },
          "& .MuiTabs-indicator": { backgroundColor: "#6C63FF" },
        }}
      >
        <Tab label="Expenses" />
        <Tab label="Balances" />
        <Tab label="Activity" />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && <ExpenseListView groupId={groupId} userId={userId} group={group} />}
      {tab === 1 && <BalancesView groupId={groupId} userId={userId} group={group} />}
      {tab === 2 && <ActivityView groupId={groupId} />}

      {/* Add Expense FAB */}
      <Fab
        color="primary"
        onClick={() => setExpenseDialogOpen(true)}
        sx={{
          position: "fixed",
          bottom: 24,
          right: 24,
          backgroundColor: "#6C63FF",
          "&:hover": { backgroundColor: "#5A52D5" },
        }}
      >
        <AddIcon />
      </Fab>

      {/* Expense Form Dialog */}
      <ExpenseFormDialog
        open={expenseDialogOpen}
        onClose={() => setExpenseDialogOpen(false)}
        groupId={groupId}
        group={group}
        userId={userId}
      />

      {/* Invite Dialog */}
      <InviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        groupId={groupId}
      />
    </div>
  );
}

