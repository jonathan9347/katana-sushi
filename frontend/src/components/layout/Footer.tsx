import { Facebook, Instagram, Linkedin, Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="mt-6 border-t border-[color:var(--customer-border)] bg-[var(--customer-bg)] text-[color:var(--customer-text)] sm:mt-12">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <img src="/images/katana-logo.jpg" alt="Katana Sushi" className="mb-4 h-14 w-auto object-contain" />
            <p className="max-w-xs text-sm text-[color:var(--customer-muted)]">Crafted sushi for every moment.</p>
          </div>

          <div>
            <h4 className="mb-3 font-semibold text-[color:var(--customer-text)]">Follow Us</h4>
            <div className="flex items-center gap-3">
              <a href="https://www.facebook.com/" target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--customer-surface-2)] text-[color:var(--customer-text)]">
                <Facebook className="h-4 w-4" />
              </a>
              <a href="#" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--customer-surface-2)] text-[color:var(--customer-text)]">
                <Linkedin className="h-4 w-4" />
              </a>
              <a href="#" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--customer-surface-2)] text-[color:var(--customer-text)]">
                <Instagram className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-3 text-sm">
              <a href="https://www.facebook.com/profile.php?id=61578608710050" target="_blank" rel="noreferrer" className="font-semibold text-[color:var(--customer-muted)] hover:text-katana-red">Katana on Facebook</a>
            </div>
          </div>

          <div>
            <h4 className="mb-3 font-semibold text-[color:var(--customer-text)]">Support</h4>
            <p className="text-sm text-[color:var(--customer-muted)]">DLU building, Lumiyap Divisoria, Zamboanga City, Philippines, 7000</p>
            <div className="mt-3 flex items-center gap-2 text-sm text-[color:var(--customer-muted)]">
              <Phone className="h-4 w-4 text-katana-red" />
              <a href="tel:09052458623" className="hover:text-katana-red">0905 245 8623</a>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm text-[color:var(--customer-muted)]">
              <Mail className="h-4 w-4 text-katana-red" />
              <a href="mailto:katana@example.com" className="hover:text-katana-red">katana@example.com</a>
            </div>
          </div>

          <div>
            <h4 className="mb-3 font-semibold text-[color:var(--customer-text)]">Menu</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/" className="hover:text-katana-red">Home</Link>
              </li>
              <li>
                <Link to="/menu" className="hover:text-katana-red">Menu</Link>
              </li>
              <li>
                <Link to="/reserve" className="hover:text-katana-red">Dine In</Link>
              </li>
              <li>
                <Link to="/catering" className="hover:text-katana-red">Cater</Link>
              </li>
              <li>
                <Link to="/reservation/status" className="hover:text-katana-red">Status</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[color:var(--customer-border)] pt-6 text-center text-xs text-[color:var(--customer-muted)]">
          © {new Date().getFullYear()} Katana Sushi. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
