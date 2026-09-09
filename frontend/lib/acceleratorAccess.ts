export type AcceleratorAccessRole = "global_admin" | "organizer" | "tracker" | "expert" | "resident";

export type AcceleratorAccess = {
  id: number;
  access_role: AcceleratorAccessRole;
};

export type AcceleratorMembershipAccess = {
  membership_id: number;
  status: string;
  accelerator: { id: number };
};

const PARTICIPANT_STATUSES = new Set(["accepted", "enrolled", "suspended", "completed"]);

export function participantMemberships<T extends AcceleratorMembershipAccess>(memberships: T[]): T[] {
  return memberships.filter((membership) => PARTICIPANT_STATUSES.has(membership.status));
}

export function preferredParticipantMembership<T extends AcceleratorMembershipAccess>(memberships: T[]): T | null {
  return participantMemberships(memberships)[0] || null;
}

export function staffAccelerators<T extends AcceleratorAccess>(accelerators: T[]): T[] {
  return accelerators.filter((accelerator) => accelerator.access_role !== "resident");
}

export function acceleratorEntryHref(
  memberships: AcceleratorMembershipAccess[],
  accelerators: AcceleratorAccess[],
  isGlobalAdmin = false,
): string | null {
  const membership = preferredParticipantMembership(memberships);
  if (membership) return `/accelerator/my/${membership.membership_id}`;
  if (isGlobalAdmin || staffAccelerators(accelerators).length > 0) return "/accelerator?context=staff";
  return null;
}
