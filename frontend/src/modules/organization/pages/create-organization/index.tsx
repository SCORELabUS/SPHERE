import { useState } from 'react';
import { useOrganizationsApi } from '../../api/organizationsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import customAlert from '../../../core/utils/custom-alert';
import OrgAvatar from '../../../core/components/org-avatar';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function CreateOrganizationPage() {
  const [orgName, setOrgName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createOrganization } = useOrganizationsApi();
  const router = useRouter();

  const slug = generateSlug(orgName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    createOrganization({ name: slug, displayName: orgName.trim(), description: description || undefined })
      .then((org) => router.push(`/me/orgs/${org.id}`))
      .catch((err: Error) => {
        customAlert(err.message, 'error');
        setIsSubmitting(false);
      });
  };

  return (
    <div className="mx-auto mt-4 w-[90vw] max-w-150 px-4 py-8">
      <h1 className="mb-6 text-center text-2xl font-bold text-sphere-grey-800">Create a new organization</h1>

      <div className="flex justify-center mb-4">
        <OrgAvatar
          name={orgName || '?'}
          size={72}
        />
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-sphere-grey-700" htmlFor="org-name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="org-name"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="My Organization"
            required
            maxLength={255}
            className="rounded-md border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm outline-none focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
          />
          {orgName.trim() && (
            <p className="text-xs text-sphere-grey-500">
              Slug: <span className="font-mono text-sphere-grey-700">{slug}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-sphere-grey-700" htmlFor="org-description">
            Description
          </label>
          <textarea
            id="org-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short description of your organization"
            rows={3}
            maxLength={500}
            className="rounded-md border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm outline-none focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
          />
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="cursor-pointer rounded-md border border-sphere-grey-300 px-5 py-2 text-sm font-semibold text-sphere-grey-700 transition-colors hover:bg-sphere-grey-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || slug.length < 3}
            className="cursor-pointer rounded-md bg-tp-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-tp-primary disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create organization'}
          </button>
        </div>
      </form>
    </div>
  );
}
