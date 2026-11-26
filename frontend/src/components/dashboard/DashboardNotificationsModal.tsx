import { useEffect, useId, useRef } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import type { DashboardNotification } from "../../lib/staffDashboard";
import { formatManilaDate, formatTime12 } from "../../lib/dateTime";

export type NotificationReviewItem = {
  notification: DashboardNotification;
  status: "pending" | "approved" | "declined";
};

type Props = {
  items: NotificationReviewItem[];
  open: boolean;
  pendingActionKey: string | null;
  onAction: (notification: DashboardNotification, status: "approved" | "declined") => void;
  onClose: () => void;
};

export function notificationKey(notification: DashboardNotification) {
  return `${notification.type}:${notification.id}`;
}

function serviceLabel(type: DashboardNotification["type"]) {
  if (type === "catering") return "Catering";
  if (type === "pickup") return "Pickup";
  return "Dine-in";
}

function guestsLabel(notification: DashboardNotification) {
  return notification.details.match(/\b\d+\s+guests?\b/i)?.[0] ?? "—";
}

function NotificationCard({
  item,
  pendingActionKey,
  onAction,
  showActions = true
}: {
  item: NotificationReviewItem;
  pendingActionKey: string | null;
  onAction: Props["onAction"];
  showActions?: boolean;
}) {
  const { notification, status } = item;
  const key = notificationKey(notification);
  const busy = pendingActionKey === `${key}:approved` || pendingActionKey === `${key}:declined`;
  const actionInProgress = busy;
  const serviceDetails = notification.type === "catering"
    ? notification.details.split(" · ")[0]
    : notification.type === "pickup"
      ? notification.details
      : "Table reservation";
  const statusClass = status === "approved"
    ? "is-approved"
    : status === "declined"
      ? "is-declined"
      : "is-pending";

  return (
    <article className="admin-notification-detail">
      <header className="admin-notification-detail-heading">
        <div className="min-w-0">
          <h3>{notification.customerName}</h3>
          <p>{notification.type === "table" ? "Dine-in request" : notification.type === "catering" ? "Catering request" : "Pickup order"}</p>
        </div>
        <span className={`admin-status-pill ${statusClass}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
      </header>
      <dl className="admin-notification-details-grid">
        <div><dt>Reference</dt><dd>{notification.reference}</dd></div>
        <div>
          <dt>Date &amp; time</dt>
          <dd>{formatManilaDate(notification.date, { month: "short", day: "numeric", year: "numeric" })}{notification.time ? ` · ${formatTime12(notification.time)}` : ""}</dd>
        </div>
        <div><dt>Service</dt><dd>{serviceDetails || serviceLabel(notification.type)}</dd></div>
        <div><dt>Guests</dt><dd>{guestsLabel(notification)}</dd></div>
      </dl>
      {(status === "pending" || actionInProgress) && showActions && (
        <div className="admin-notification-actions">
          <button
            type="button"
            className="admin-button admin-button-secondary"
            disabled={busy || pendingActionKey !== null}
            onClick={() => onAction(notification, "declined")}
          >
            {pendingActionKey === `${key}:declined` ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" /> : null}
            Decline
          </button>
          <button
            type="button"
            className="admin-button admin-button-primary"
            disabled={busy || pendingActionKey !== null}
            onClick={() => onAction(notification, "approved")}
          >
            {pendingActionKey === `${key}:approved` ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" /> : <Check aria-hidden="true" />}
            Approve
          </button>
        </div>
      )}
    </article>
  );
}

export default function DashboardNotificationsModal({ items, open, pendingActionKey, onAction, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === dialogRef.current) {
        event.preventDefault();
        first.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="admin-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="admin-modal-dialog"
      >
        <header className="admin-modal-header">
          <div>
            <h2 id={titleId}>Notifications</h2>
            <p>Review and respond without leaving the dashboard.</p>
          </div>
          <button type="button" className="admin-icon-button" aria-label="Close notifications" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="admin-modal-body">
          {items.length ? (
            <div className="admin-notification-list">
              {items.map((item) => (
                <NotificationCard
                  key={notificationKey(item.notification)}
                  item={item}
                  pendingActionKey={pendingActionKey}
                  onAction={onAction}
                  showActions={items.length > 1}
                />
              ))}
            </div>
          ) : (
            <div className="admin-empty-state">
              <span className="admin-empty-icon"><Check aria-hidden="true" /></span>
              <strong>All caught up</strong>
              <p>New requests will appear here when they need your attention.</p>
            </div>
          )}
        </div>
        <footer className="admin-modal-footer">
          <button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Close</button>
          {items.length === 1 && (
            items[0].status === "pending" ||
            pendingActionKey?.startsWith(`${notificationKey(items[0].notification)}:`)
          ) && (
            <div className="admin-notification-actions admin-notification-footer-actions">
              <button
                type="button"
                className="admin-button admin-button-secondary"
                disabled={pendingActionKey !== null}
                onClick={() => onAction(items[0].notification, "declined")}
              >
                {pendingActionKey === `${notificationKey(items[0].notification)}:declined`
                  ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" />
                  : null}
                Decline
              </button>
              <button
                type="button"
                className="admin-button admin-button-primary"
                disabled={pendingActionKey !== null}
                onClick={() => onAction(items[0].notification, "approved")}
              >
                {pendingActionKey === `${notificationKey(items[0].notification)}:approved`
                  ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" />
                  : <Check aria-hidden="true" />}
                Approve
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
