import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { useSessionTimeout } from "./hooks/useSessionTimeout";
import CustomerNav from "./components/layout/CustomerNav";
import Footer from "./components/layout/Footer";
import StaffSidebar from "./components/layout/StaffSidebar";
import UnlimitedSettings from "./pages/admin/UnlimitedSettings";
import CateringInquiry from "./pages/customer/CateringInquiry";
import CateringReservation from "./pages/customer/CateringReservation";
import CateringReservationIntro from "./pages/customer/CateringReservationIntro";
import CustomerHome from "./pages/customer/Home";
import DineInReservationIntro from "./pages/customer/DineInReservationIntro";
import Menu from "./pages/customer/Menu";
import ReservationForm from "./pages/customer/ReservationForm";
import ReservationStatus from "./pages/customer/ReservationStatus";
import CateringReservations from "./pages/staff/catering/CateringReservations";
import InventoryPage from "./pages/staff/inventory";
import AnalyticsPage from "./pages/staff/analytics";
import Dashboard from "./pages/staff/Dashboard";
import SettingsPage from "./pages/staff/Settings";
import Login from "./pages/staff/Login";
import PosPage from "./pages/staff/pos";
import PosHistory from "./pages/staff/pos/PosHistory";
import DineInReservations from "./pages/staff/reservations/DineInReservations";

function StaffPage({ roles, children }: { roles: string[]; children: JSX.Element }) {
  useSessionTimeout();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  return (
    <ProtectedRoute allowedRoles={roles}>
      <div className="min-h-screen bg-slate-100 text-slate-900 md:pl-20">
        <StaffSidebar />
        {children}
      </div>
    </ProtectedRoute>
  );
}

function CustomerPage({ children }: { children: JSX.Element }) {
  return (
    <div className="customer-app pb-8 md:pb-0">
      <CustomerNav />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CustomerPage><><CustomerHome /><Footer /></></CustomerPage>} />
      <Route path="/menu" element={<CustomerPage><Menu /></CustomerPage>} />
      <Route path="/reserve" element={<CustomerPage><DineInReservationIntro /></CustomerPage>} />
      <Route path="/reserve/book" element={<CustomerPage><ReservationForm /></CustomerPage>} />
      <Route path="/reservation/status" element={<CustomerPage><ReservationStatus /></CustomerPage>} />
      <Route path="/catering" element={<CustomerPage><CateringReservationIntro /></CustomerPage>} />
      <Route path="/catering/book" element={<CustomerPage><CateringReservation /></CustomerPage>} />
      <Route path="/catering/inquiry" element={<CustomerPage><CateringInquiry /></CustomerPage>} />
      <Route path="/staff/login" element={<Login />} />
      <Route path="/staff/dashboard" element={<StaffPage roles={["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]}><Dashboard /></StaffPage>} />
      <Route path="/staff/inventory" element={<StaffPage roles={["admin", "inventory_manager"]}><InventoryPage /></StaffPage>} />
      <Route path="/staff/inventory/read-only" element={<StaffPage roles={["admin", "inventory_manager", "chef"]}><InventoryPage readOnly /></StaffPage>} />
      <Route path="/staff/pos" element={<StaffPage roles={["admin", "cashier"]}><PosPage /></StaffPage>} />
      <Route path="/staff/pos/history" element={<StaffPage roles={["admin", "cashier"]}><PosHistory /></StaffPage>} />
      <Route path="/staff/pos/unlimited-settings" element={<StaffPage roles={["admin", "cashier"]}><UnlimitedSettings /></StaffPage>} />
      <Route path="/admin/unlimited-settings" element={<Navigate to="/staff/pos/unlimited-settings" replace />} />
      <Route path="/staff/settings" element={<StaffPage roles={["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]}><SettingsPage /></StaffPage>} />
      <Route path="/staff/analytics" element={<StaffPage roles={["admin", "inventory_manager"]}><AnalyticsPage /></StaffPage>} />
      <Route
        path="/staff/reservations"
        element={
          <StaffPage roles={["admin", "receptionist"]}>
            <DineInReservations />
          </StaffPage>
        }
      />
      <Route path="/staff/reservations/pending" element={<Navigate to="/staff/reservations" replace />} />
      <Route path="/staff/reservations/calendar" element={<Navigate to="/staff/reservations" replace />} />
      <Route
        path="/staff/catering"
        element={
          <StaffPage roles={["admin", "event_coordinator"]}>
            <CateringReservations />
          </StaffPage>
        }
      />
      <Route path="/staff/catering/dashboard" element={<Navigate to="/staff/catering" replace />} />
      <Route
        path="*"
        element={
          <main className="flex min-h-screen flex-col items-center justify-center gap-4">
            <h1 className="text-2xl font-semibold">Page not found</h1>
            <Link className="text-red-700 underline" to="/">
              Go home
            </Link>
          </main>
        }
      />
    </Routes>
  );
}
