"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useState } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
      <Box
        component="nav"
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          px: 2,
          py: 1.5,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <IconButton
              onClick={() => setDrawerOpen(true)}
              size="small"
              sx={{ display: { xs: "inline-flex", lg: "none" } }}
            >
              <MenuIcon />
            </IconButton>

            <Box
              component={Link}
              href="/dashboard"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                textDecoration: "none",
              }}
            >
              <Typography component="span" sx={{ fontSize: "1.5rem" }}>💰</Typography>
              <Typography
                component="span"
                sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary" }}
              >
                SplitWise
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography
              variant="body2"
              sx={{
                display: { xs: "none", sm: "block" },
                color: "text.secondary",
              }}
            >
              {user.name}
            </Typography>
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
              <Avatar
                src={user.image || undefined}
                alt={user.name || "User"}
                sx={{ width: 32, height: 32 }}
              />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" fontWeight={500} color="text.primary">
            {user.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.email}
          </Typography>
        </Box>
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
        <Box sx={{ width: 256, p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
            <Typography component="span" sx={{ fontSize: "1.5rem" }}>💰</Typography>
            <Typography
              component="span"
              sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary" }}
            >
              SplitWise
            </Typography>
          </Stack>
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
                      color: "primary.main",
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Icon
                      fontSize="small"
                      sx={{ color: isActive ? "primary.main" : undefined }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Drawer>
    </>
  );
}
