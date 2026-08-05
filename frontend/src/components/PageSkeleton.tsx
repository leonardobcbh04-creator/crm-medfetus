type PageSkeletonProps = {
  cards?: number;
};

export function PageSkeleton({ cards = 3 }: PageSkeletonProps) {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Carregando...</span>
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-subtitle" />
      <div className="skeleton-card-grid">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="skeleton-card">
            <div className="skeleton-block skeleton-line" />
            <div className="skeleton-block skeleton-line skeleton-line-short" />
            <div className="skeleton-block skeleton-line" />
            <div className="skeleton-block skeleton-line skeleton-line-short" />
          </div>
        ))}
      </div>
    </div>
  );
}
