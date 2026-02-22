import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Sidebar from "@/components/layout/Sidebar";
import Navbar from "@/components/layout/Navbar";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar user={session.user} />
      <div className="flex">
        <Sidebar />
        <Box
          component="main"
          sx={{
            flex: 1,
            p: 3,
            ml: { xs: 0, lg: "240px" },
          }}
        >
          {children}
        </Box>
      </div>
    </div>
  );
}

