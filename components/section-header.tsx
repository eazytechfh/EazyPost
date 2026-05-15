export function SectionHeader({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-app-white">{title}</h1>
      <p className="mt-1 text-sm text-app-muted">{description}</p>
    </div>
  );
}
