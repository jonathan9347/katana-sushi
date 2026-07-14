import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";

function defaultRouteForRole(role: string) {
  const normalized = role.toLowerCase();

  if (normalized === "admin") {
    return "/staff/dashboard";
  }
  if (normalized === "inventory_manager") {
    return "/staff/inventory";
  }
  if (normalized === "cashier") {
    return "/staff/pos";
  }
  if (normalized === "receptionist") {
    return "/staff/reservations";
  }
  if (normalized === "event_coordinator") {
    return "/staff/catering";
  }
  if (normalized === "chef") {
    return "/staff/inventory/read-only";
  }

  return "/staff/dashboard";
}

export default function Login() {
  const [email, setEmail] = useState("admin@katana.com");
  const [password, setPassword] = useState("Admin123!");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  async function loginWithCredentials(emailValue: string, passwordValue: string) {
    setMessage("");

    try {
      const response = await api.post<{ token: string; user: { id: string; email: string; role: string; name: string } }>(
        "/api/auth/login",
        { email: emailValue, password: passwordValue }
      );

      localStorage.setItem("katana_token", response.data.token);
      localStorage.setItem("katana_role", response.data.user.role.toLowerCase());
      localStorage.setItem("katana_user", JSON.stringify(response.data.user));
      setMessage(`Logged in as ${response.data.user.name}`);
      navigate(defaultRouteForRole(response.data.user.role));
    } catch {
      setMessage("Invalid credentials. Please try again.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loginWithCredentials(email, password);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_#fff7ed,_#f8fafc_55%,_#f1f5f9_100%)] px-6 py-10 text-slate-900">
      <div className="w-full max-w-xl">
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)]">
          <div className="bg-[linear-gradient(135deg,_#fff7ed_0%,_#fff_55%,_#fef2f2_100%)] px-8 py-8 sm:px-10 sm:py-10">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-2xl text-white">🍣</div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-red-600">Katana Sushi</p>
                <p className="text-sm font-medium text-slate-600">Staff portal</p>
              </div>
            </div>

            <h1 className="mt-6 text-3xl font-black tracking-[0.02em] text-slate-950 sm:text-4xl" style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif' }}>
              Staff login
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
              Enter your email and password to continue managing your daily service flow.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-8 sm:px-10 sm:py-10">
            <div className="space-y-5">
              <label className="block text-sm text-slate-700">
                <span className="mb-2 block font-medium text-slate-800">Email address</span>
                <input
                  className="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-slate-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label className="block text-sm text-slate-700">
                <span className="mb-2 block font-medium text-slate-800">Password</span>
                <input
                  className="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-5 py-4 text-slate-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="submit" className="w-full sm:w-auto" variant="default" size="md">
                Sign in now
              </Button>
              <Link to="/" className="text-sm font-semibold text-slate-500 transition hover:text-slate-900">
                Return to public site
              </Link>
            </div>

            {message && (
              <div className="mt-6 rounded-[20px] border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                {message}
              </div>
            )}

            <p className="mt-8 text-sm text-slate-500">
              Need help? Contact your manager to reset your login access.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
