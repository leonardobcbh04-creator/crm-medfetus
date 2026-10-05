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

// Link para abrir conversa no WhatsApp com o texto pronto. Usa api.whatsapp.com/send
// (e nao wa.me): o redirecionamento do wa.me quebra emojis como 😊 e 💚 no
// WhatsApp Web/desktop, que chegam como "\uFFFD".
export function buildWhatsAppUrl(phone, message) {
  return `https://api.whatsapp.com/send?phone=${toWhatsAppPhone(phone)}&text=${encodeURIComponent(message)}`;
}
