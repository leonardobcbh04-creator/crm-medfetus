type IconProps = {
  className?: string;
};

const baseProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.5" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.5" />
    </svg>
  );
}

export function PatientAddIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="9.5" cy="8" r="3.3" />
      <path d="M3.5 20c0-3.4 2.7-6 6-6s6 2.6 6 6" />
      <path d="M18 8.5v5M15.5 11h5" />
    </svg>
  );
}

export function PatientsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2.8 20c0-3.2 2.5-5.7 5.7-5.7s5.7 2.5 5.7 5.7" />
      <circle cx="16.3" cy="8.7" r="2.5" />
      <path d="M14.6 14.6c2.9 0.4 5.1 2.7 5.6 5.4" />
    </svg>
  );
}

export function FlowIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="3" y="3.5" width="5.5" height="17" rx="1.4" />
      <rect x="9.7" y="3.5" width="5.5" height="10" rx="1.4" />
      <rect x="16.5" y="3.5" width="5.5" height="14" rx="1.4" />
    </svg>
  );
}

export function ContactsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 5.5h16v11.5H9.5L5 21v-4H4z" />
      <path d="M8 9.5h8M8 12.7h5" />
    </svg>
  );
}

export function ReviewIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="5.5" y="4" width="13" height="17" rx="1.6" />
      <path d="M9.2 3.2h5.6a1 1 0 0 1 1 1v1.4h-7.6V4.2a1 1 0 0 1 1-1Z" />
      <path d="m9 13 2 2 4-4.4" />
    </svg>
  );
}

export function ReportsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 20.5V3.5" />
      <path d="M4 20.5h16" />
      <rect x="6.6" y="13" width="3" height="7.5" rx="0.8" />
      <rect x="11.6" y="9" width="3" height="11.5" rx="0.8" />
      <rect x="16.6" y="5.5" width="3" height="15" rx="0.8" />
    </svg>
  );
}

export function AdminIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.7 6.3l-1.55 1.55M7.85 16.15 6.3 17.7M17.7 17.7l-1.55-1.55M7.85 7.85 6.3 6.3" />
    </svg>
  );
}
