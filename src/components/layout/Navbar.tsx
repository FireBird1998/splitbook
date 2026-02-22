"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useState } from "react";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Divider from "@mui/material/Divider";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import DashboardIcon from "@mui/icons-material/Dashboard";
import GroupIcon from "@mui/icons-material/Group";
import MenuIcon from "@mui/icons-material/Menu";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { usePathname } from "next/navigation";

interface NavbarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

const mobileNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/groups", label: "Groups", icon: GroupIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Navbar({ user }: NavbarProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <IconButton
              onClick={() => setDrawerOpen(true)}
              size="small"
              sx={{ display: { xs: "inline-flex", lg: "none" } }}
            >
              <MenuIcon />
            </IconButton>

            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-2xl">💰</span>
              <span className="text-lg font-bold text-gray-900">SplitWise</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-sm text-gray-600">
              {user.name}
            </span>
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
              <Avatar
                src={user.image || undefined}
                alt={user.name || "User"}
                sx={{ width: 32, height: 32 }}
              />
            </IconButton>
          </div>
        </div>
      </nav>

      {/* User Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        slotProps={{
          paper: {
            sx: { mt: 1, minWidth: 200 },
          },
        }}
      >
        <div className="px-4 py-2">
          <p className="text-sm font-medium text-gray-900">{user.name}</p>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>
        <Divider />
        <MenuItem
          component={Link}
          href="/settings"
          onClick={() => setAnchorEl(null)}
        >
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            signOut({ callbackUrl: "/" });
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign Out
        </MenuItem>
      </Menu>

      {/* Mobile Drawer */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <div className="w-64 p-4">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-2xl">💰</span>
            <span className="text-lg font-bold text-gray-900">SplitWise</span>
          </div>
          <List>
            {mobileNavItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;

              return (
                <ListItemButton
                  key={item.href}
                  component={Link}
                  href={item.href}
                  selected={isActive}
                  onClick={() => setDrawerOpen(false)}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    "&.Mui-selected": {
                      backgroundColor: "rgba(108,99,255,0.1)",
                      color: "#6C63FF",
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Icon
                      fontSize="small"
                      sx={{ color: isActive ? "#6C63FF" : undefined }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              );
            })}
          </List>
        </div>
      </Drawer>
    </>
  );
}

