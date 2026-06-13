import { Contribution } from '../../../pages/contributions/data/contributions-data';

export default function ContributionCard({
  contribution,
  onClick,
}: {
  contribution: Contribution;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="relative h-[400px] max-w-[400px] cursor-pointer overflow-hidden rounded-lg p-2 shadow-md transition-shadow duration-300 hover:shadow-[0_0_10px_2px_rgba(2,62,138,0.5)]"
    >
      <div>
        <div className="flex h-[65px] items-center justify-center">
          <h3 className="mt-1 text-center text-xl font-bold">
            {contribution.title}
          </h3>
        </div>
        <div className="relative mt-1 max-h-[200px] overflow-hidden">
          <p className="mt-1 h-[200px] text-justify text-sm text-sphere-grey-600">
            {contribution.description}
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-b from-[rgba(0,0,0,0.01)] to-white" />
        </div>
        <div className="mt-2 flex max-h-[34px] flex-wrap justify-evenly gap-2 overflow-hidden">
          {contribution.tags.map(tag => tag)}
        </div>
        <p className="mt-2 block text-xs text-sphere-grey-600">
          <span className="font-bold">
            Supervisor/s:
          </span>{' '}
          {contribution.supervisor.length > 40
            ? `${contribution.supervisor.slice(0, 37)}...`
            : contribution.supervisor}
        </p>
      </div>
    </div>
  );
}
