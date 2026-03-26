import { Link } from "react-router-dom";

type StatCardProps = {
  label: string;
  value: number;
  description: string;
  to?: string;
};

export function StatCard({ label, value, description, to }: StatCardProps) {
  const content = (
    <article className={`stat-card ${to ? "stat-card-link" : ""}`}>
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
