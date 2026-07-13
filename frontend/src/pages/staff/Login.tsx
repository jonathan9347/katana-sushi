import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";

const quickCredentials: Record<string, { email: string; password: string; label: string }> = {
  admin: { email: "admin@katana.com", password: "Admin123!", label: "Admin" },
  inventory: { email: "inventory@katana.com", password: "Inventory123!", label: "Inventory Manager" },
  cashier: { email: "cashier@katana.com", password: "Cashier123!", label: "Cashier" },
  reception: { email: "reception@katana.com", password: "Reception123!", label: "Receptionist" },
  events: { email: "events@katana.com", password: "Events123!", label: "Event Coordinator" },
  chef: { email: "chef@katana.com", password: "Chef123!", label: "Chef" }
};

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
  const [activeRole, setActiveRole] = useState("Admin");
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

  async function quickLogin(role: string) {
    const credentials = quickCredentials[role];
    if (!credentials) {
      return;
    }
    setEmail(credentials.email);
    setPassword(credentials.password);
    setActiveRole(credentials.label);
    await loginWithCredentials(credentials.email, credentials.password);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-10 text-slate-900">
      <div className="w-full max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.9fr]">
          <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-10 shadow-lg">

            <div className="relative z-10 rounded-3xl bg-slate-50 p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-red-600 text-3xl text-white">🍣</div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-600">Katana Sushi</p>
                  <h1 className="mt-3 text-4xl font-black text-slate-950 sm:text-5xl">Staff access made effortless</h1>
                </div>
              </div>
            </div>

            <p className="relative z-10 mt-8 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
              A polished sign-in experience for your restaurant team. Pick your role to quickly access the right workflow, from inventory to catering.
            </p>

            <div className="relative z-10 mt-10 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Current Role</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{activeRole}</p>
                </div>
                <span className="rounded-full bg-red-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-red-700">
                  quick login
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(quickCredentials).map(([key, credential]) => (
                  <Button
                    key={key}
                    type="button"
                    variant={activeRole === credential.label ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => void quickLogin(key)}
                  >
                    <div>
                      <p className="font-semibold text-slate-950">{credential.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{credential.email}</p>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-8 rounded-[1.75rem] bg-slate-50 p-6 ring-1 ring-slate-200">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Demo credentials</p>
              <div className="mt-4 grid gap-3">
                {Object.values(quickCredentials).map((credential) => (
                  <div key={credential.email} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
                    <span className="font-semibold text-slate-950">{credential.label}</span>: {credential.email} / {credential.password}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <form onSubmit={handleSubmit} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white px-8 py-10 shadow-2xl shadow-slate-200/50">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.36em] text-red-600">Welcome back</p>
              <h2 className="mt-3 text-4xl font-black text-slate-950">Staff login</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
                Enter your email and password to manage inventory, reservations, POS, and catering workflows.
              </p>
            </div>

            <div className="space-y-6">
              <label className="block text-sm text-slate-700">
                <span className="mb-2 block font-medium text-slate-800">Email address</span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label className="block text-sm text-slate-700">
                <span className="mb-2 block font-medium text-slate-800">Password</span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
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
              <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
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
