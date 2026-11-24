export type NotificationPreferences = { email: boolean; sms: boolean };

const DEFAULT_PREFERENCES: NotificationPreferences = { email: true, sms: false };

let resolver: (() => Promise<NotificationPreferences>) | null = null;

/** app.ts registers the admin "Email/SMS notifications" switches from system settings. */
export function registerNotificationPreferences(next: () => Promise<NotificationPreferences>) {
  resolver = next;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  if (!resolver) {
    return DEFAULT_PREFERENCES;
  }
  try {
    return await resolver();
  } catch (error) {
    console.error("[Notifications] Could not read notification settings; using defaults:", error instanceof Error ? error.message : error);
    return DEFAULT_PREFERENCES;
  }
}
