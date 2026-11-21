export { SLUG_MAX, SLUG_MIN, SLUG_RE, isSlugShape } from "./slug";
export { CONTACT_EMAIL, EXTERNAL_LINK_ALLOWLIST, LINKS, assertContactEmail, assertExternal } from "./links";
export { RESERVED_PREFIXES, RESERVED_SLUGS, isReservedSlug } from "./reserved";

/** A lista completa, inclusive os acréscimos da M4. */
export { RESERVED_SLUGS as reservedSlugs } from "./reserved";

export const paymentModes = ["pay_at_location", "pix_optional"] as const;
