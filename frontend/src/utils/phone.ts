export function normalizeBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length > 11 && digits.startsWith("55")) {
    return digits.slice(2, 13);
  }

  return digits.slice(0, 11);
}

export function formatBrazilPhone(value: string) {
  const digits = normalizeBrazilPhone(value);

  if (!digits) {
    return "";
  }

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function getWhatsAppUrl(phone: string, message: string) {
  const digits = normalizeBrazilPhone(phone);
  const whatsappNumber = digits ? `55${digits}` : "";
  return `https://wa.me/${whatsappNumber}?text=${message}`;
}
