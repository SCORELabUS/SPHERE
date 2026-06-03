import { useState } from 'react';
import { useOrganizationsApi } from '../../api/organizationsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import { useOrganization } from '../../hooks/useOrganization';
import customAlert from '../../../core/utils/custom-alert';
import OrgAvatar from '../../../core/components/org-avatar';
import SlugPreview from '../../../core/components/slug-preview';
import { generateSlug } from '../../../core/utils/generate-slug';

export default function CreateOrganizationPage() {
  const [orgName, setOrgName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createOrganization } = useOrganizationsApi();
  const { refresh } = useOrganization();
  const router = useRouter();

  const slug = generateSlug(orgName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    createOrganization({ name: slug, displayName: orgName.trim(), description: description || undefined })
      .then(() => {
        refresh();
        router.push('/me/orgs');
      })
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
          <SlugPreview value={orgName} />
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
