import { Link } from "react-router-dom";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-red-700">Welcome</p>
      <h1 className="text-4xl font-bold text-slate-950">Katana Sushi</h1>
      <p className="max-w-xl text-slate-600">
        Fresh setup for the Katana Sushi Management System.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/reserve" className="rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800">
          Book a Table
        </Link>
        <Link to="/reservation/status" className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50">
          Check Status
        </Link>
        <Link to="/catering/inquiry" className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50">
          Catering Inquiry
        </Link>
        <Link to="/staff/login" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 font-medium text-red-700 hover:bg-red-100">
          Staff Login
        </Link>
      </div>
    </main>
  );
}
