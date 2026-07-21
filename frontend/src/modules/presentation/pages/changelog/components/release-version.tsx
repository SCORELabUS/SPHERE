interface ReleaseVersionProps {
  version: string;
  releaseDate: string;
}

export default function ReleaseVersion({ version, releaseDate }: ReleaseVersionProps) {

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year:'numeric'
  })

  const parsedDate = new Date(releaseDate)

  return (
    <td className="py-8 align-top">
      <p className="text-lg font-medium text-tp-ink">
        <span>{version}</span>
        <br />
        <time className="text-sm text-tp-muted" dateTime={releaseDate}>{dateFormat.format(parsedDate)}</time>
      </p>
    </td>
  );
}
