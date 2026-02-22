"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import DashboardIcon from "@mui/icons-material/Dashboard";
import GroupIcon from "@mui/icons-material/Group";
import SettingsIcon from "@mui/icons-material/Settings";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/groups", label: "Groups", icon: GroupIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <Box
      component="aside"
      sx={{
        display: { xs: "none", lg: "flex" },
        flexDirection: "column",
        width: 240,
        position: "fixed",
        top: 64,
        bottom: 0,
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        p: 2,
        pt: 3,
      }}
    >
      <nav className="space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[#6C63FF]/10 text-[#6C63FF]"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon fontSize="small" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </Box>
  );
}

