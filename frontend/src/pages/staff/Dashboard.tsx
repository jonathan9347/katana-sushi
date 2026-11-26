import { useAuth } from "../../hooks/useAuth";
import AdminDashboard from "../../components/dashboard/AdminDashboard";
import StaffDashboard from "../../components/dashboard/StaffDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "admin") {
    return <AdminDashboard />;
  }
  return <StaffDashboard />;
}
