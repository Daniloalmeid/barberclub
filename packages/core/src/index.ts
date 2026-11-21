export const appointmentStatuses = [
  "hold",
  "pending_payment",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
  "expired",
  "payment_conflict",
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const bookableTenantStatuses = ["trial", "active"] as const;
