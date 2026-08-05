import { Link } from "react-router-dom";

type StatCardProps = {
  label: string;
  value: number;
  description: string;
  to?: string;
  severity?: "danger" | "warning";
};

export function StatCard({ label, value, description, to, severity }: StatCardProps) {
  const severityClass = severity ? `stat-card-${severity}` : "";

  const content = (
    <article className={`stat-card ${to ? "stat-card-link" : ""} ${severityClass}`}>
      <p className="stat-label">{label}</p>
      <strong className="stat-value">{value}</strong>
      <span>{description}</span>
    </article>
  );

  if (to) {
    return <Link to={to} className="card-link-reset">{content}</Link>;
  }

  return content;
}
