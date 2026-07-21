import type { Release } from '../types';
import ReleaseContent from './release-content';
import ReleaseSection from './release-section';
import ReleaseVersion from './release-version';

interface ChangelogProps {
  releases: Release[]
}

export default function Changelog({ releases }: ChangelogProps) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-y-8">
      <thead>
        <tr className="border-solid border-b-gray-800">
          <th className="w-48 text-left text-2xl font-normal">Version</th>
          <th className="text-left text-2xl font-normal">Description</th>
        </tr>
      </thead>
      <tbody>
        {releases.map(release => (
          <tr key={release.commit_id}>
            <ReleaseVersion
              version={release.version}
              releaseDate={release.release_date}
            />

            <ReleaseContent description={release.description}>
              {release.sections.map(section => (
                <ReleaseSection
                  key={section.name}
                  name={section.name}
                  features={section.features}
                  fixes={section.fixes}
                />
              ))}
            </ReleaseContent>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
