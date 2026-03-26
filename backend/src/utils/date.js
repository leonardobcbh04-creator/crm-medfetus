export function todayIso() {
  return formatIso(new Date());
}

export function formatIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + Math.round(Number(days)));
  return formatIso(date);
}

export function daysBetween(fromIso, toIso) {
  const start = new Date(`${fromIso}T12:00:00`);
  const end = new Date(`${toIso}T12:00:00`);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDatePtBr(isoDate) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${isoDate}T12:00:00`));
}
