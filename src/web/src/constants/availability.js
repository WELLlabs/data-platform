export const AVAILABILITY_PUBLIC = 0;
export const AVAILABILITY_PRIVATE = 1;
export const AVAILABILITY_ORGANIZATION = 2;
export const AVAILABILITY_ADMINS = 3;
export const AVAILABILITY_OWNERS = 4;

export const AVAILABILITY_OPTIONS = [
  { value: AVAILABILITY_PUBLIC, label: "Public" },
  { value: AVAILABILITY_PRIVATE, label: "Private" },
  { value: AVAILABILITY_ORGANIZATION, label: "Organization" },
  { value: AVAILABILITY_ADMINS, label: "Admins" },
  { value: AVAILABILITY_OWNERS, label: "Owners" },
];

export function parseAvailability(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) {
    if (value === true) return AVAILABILITY_ORGANIZATION;
    return AVAILABILITY_PUBLIC;
  }
  return n;
}

export function availabilityLabel(value) {
  const found = AVAILABILITY_OPTIONS.find(
    (opt) => opt.value === parseAvailability(value)
  );
  return found ? found.label : "Public";
}

export function isRestrictedAvailability(value) {
  return parseAvailability(value) !== AVAILABILITY_PUBLIC;
}
