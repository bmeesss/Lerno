interface PlaceholderPageProps {
  title: string;
  description: string;
}

/** Temporary page content for routes that are implemented in later phases. */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </div>
  );
}
