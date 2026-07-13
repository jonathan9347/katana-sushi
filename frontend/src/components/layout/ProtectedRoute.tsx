import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-950">
        <p className="text-lg font-semibold">Loading...</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate replace to="/staff/login" />;
  }

  if (!allowedRoles.includes(user.role)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">Access Denied</h1>
        <p className="max-w-md text-slate-600">Your account does not have permission to view this page.</p>
        <Navigate replace to="/staff/dashboard" />
      </main>
    );
  }

  return <>{children}</>;
}
