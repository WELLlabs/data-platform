export function emailDomain(email) {
  const trimmed = String(email || "").trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@")) return "";
  const domain = trimmed.slice(at + 1);
  if (!domain || domain.includes(" ") || !domain.includes(".")) return "";
  return domain;
}

/** Frontend hint only. The API enforces the same rules. */
export function organizationAccepts(org, email, provider) {
  if (!org) return false;
  const domain = emailDomain(email);
  const domains = Array.isArray(org.allowed_email_domains)
    ? org.allowed_email_domains
        .map((item) => String(item).trim().replace(/^@/, "").toLowerCase())
        .filter(Boolean)
    : [];
  if (domains.length && !domains.includes(domain)) return false;
  if (provider === "google" && org.allow_google === false) return false;
  if (provider === "password" && org.allow_password === false) return false;
  return true;
}
