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
import Feedback from "./pages/customer/Feedback";
import CustomerHome from "./pages/customer/Home";
import DineInReservationIntro from "./pages/customer/DineInReservationIntro";
import Menu from "./pages/customer/Menu";
import TableReservationForm from "./pages/customer/TableReservationForm";
import ReservationStatus from "./pages/customer/ReservationStatus";
import TakeoutOrder from "./pages/customer/TakeoutOrder";
import InventoryPage from "./pages/staff/inventory";
import CateringOptionPhotos from "./pages/staff/inventory/CateringOptionPhotos";
import AnalyticsPage from "./pages/staff/analytics";
import Dashboard from "./pages/staff/Dashboard";
import SettingsPage from "./pages/staff/Settings";
import Login from "./pages/staff/Login";
import PosPage from "./pages/staff/pos";
import DiningService from "./pages/staff/pos/DiningService";
import PosHistory from "./pages/staff/pos/PosHistory";
import DineInReservations from "./pages/staff/reservations/DineInReservations";
import CateringReservations from "./pages/staff/catering/CateringReservations";

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
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <div className="min-h-screen md:flex">
          <StaffSidebar />
          <div className="flex-1">{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function HomeCustomerLayout({ children }: { children: JSX.Element }) {
  return (
    <div className="customer-app pb-8 md:pb-0">
      <CustomerNav />
      {children}
    </div>
  );
}

function InnerCustomerLayout({ children }: { children: JSX.Element }) {
  return (
    <div className="customer-app pb-8 md:pb-0">
      <CustomerNav visible={false} />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeCustomerLayout><><CustomerHome /><Footer /></></HomeCustomerLayout>} />
      <Route path="/menu" element={<InnerCustomerLayout><Menu /></InnerCustomerLayout>} />
      <Route path="/takeout" element={<InnerCustomerLayout><TakeoutOrder /></InnerCustomerLayout>} />
      <Route path="/reserve" element={<InnerCustomerLayout><DineInReservationIntro /></InnerCustomerLayout>} />
      <Route path="/reserve/book" element={<InnerCustomerLayout><TableReservationForm /></InnerCustomerLayout>} />
      <Route path="/reservation/status" element={<InnerCustomerLayout><ReservationStatus /></InnerCustomerLayout>} />
      <Route path="/catering" element={<InnerCustomerLayout><CateringReservationIntro /></InnerCustomerLayout>} />
      <Route path="/catering/book" element={<InnerCustomerLayout><CateringReservation /></InnerCustomerLayout>} />
      <Route path="/catering/inquiry" element={<InnerCustomerLayout><CateringInquiry /></InnerCustomerLayout>} />
      <Route path="/feedback" element={<InnerCustomerLayout><Feedback /></InnerCustomerLayout>} />
      <Route path="/staff/login" element={<Login />} />
      <Route path="/staff/dashboard" element={<StaffPage roles={["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]}><Dashboard /></StaffPage>} />
      <Route path="/staff/inventory" element={<StaffPage roles={["admin", "inventory_manager"]}><InventoryPage /></StaffPage>} />
      <Route path="/staff/inventory/read-only" element={<StaffPage roles={["admin", "inventory_manager", "chef"]}><InventoryPage readOnly /></StaffPage>} />
      <Route path="/staff/pos" element={<StaffPage roles={["admin", "cashier"]}><PosPage /></StaffPage>} />
      <Route path="/staff/pos/dining" element={<Navigate to="/staff/pos" replace />} />
      <Route path="/staff/kitchen" element={<StaffPage roles={["admin", "cashier", "chef"]}><DiningService mode="kitchen" /></StaffPage>} />
      <Route path="/staff/takeout" element={<Navigate to="/staff/reservations?view=pickup" replace />} />
      <Route path="/staff/pos/history" element={<StaffPage roles={["admin", "cashier"]}><PosHistory /></StaffPage>} />
      <Route path="/staff/pos/unlimited-settings" element={<StaffPage roles={["admin", "cashier"]}><UnlimitedSettings /></StaffPage>} />
      <Route path="/admin/unlimited-settings" element={<Navigate to="/staff/pos/unlimited-settings" replace />} />
      <Route path="/staff/settings" element={<StaffPage roles={["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]}><SettingsPage /></StaffPage>} />
      <Route path="/staff/analytics" element={<StaffPage roles={["admin", "inventory_manager"]}><AnalyticsPage /></StaffPage>} />
      <Route
        path="/staff/reservations"
        element={
          <StaffPage roles={["admin", "receptionist", "cashier", "event_coordinator", "chef"]}>
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
      <Route
        path="/staff/catering/photos"
        element={
          <StaffPage roles={["admin"]}>
            <CateringOptionPhotos />
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
