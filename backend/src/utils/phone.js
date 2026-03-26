export function normalizeBrazilPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (digits.length > 11 && digits.startsWith("55")) {
    return digits.slice(2, 13);
  }

  return digits.slice(0, 11);
}

export function toWhatsAppPhone(phone) {
  const digits = normalizeBrazilPhone(phone);
  return digits ? `55${digits}` : "";
}
