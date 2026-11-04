const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<![\w])(?:\+?\d[\d().\s-]{5,}\d)(?![\w])/g;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\b/g;

export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "[masked phone]";
  return `***${digits.slice(-4)}`;
}

export function redactSensitiveText(value: string): string {
  const dates: string[] = [];
  const withDatesProtected = value.replace(ISO_DATE_PATTERN, (date) => {
    const index = dates.push(date) - 1;
    return `__ISO_DATE_${index}__`;
  });
  const withEmailsMasked = withDatesProtected.replace(
    EMAIL_PATTERN,
    (match) => {
      const domain = match.split("@")[1] ?? "";
      return `***@${domain}`;
    },
  );
  const withPhonesMasked = withEmailsMasked.replace(PHONE_PATTERN, (phone) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 7 ? `***${digits.slice(-4)}` : phone;
  });
  return withPhonesMasked.replace(/__ISO_DATE_(\d+)__/g, (_placeholder, index: string) =>
    dates[Number(index)] ?? "[date]",
  );
}
