import { useState } from 'react';
import { Organization, useOrganizationsApi } from '../../../api/organizationsApi';

export default function SettingsTab({ org, onSaved }: { org: Organization; onSaved: (org: Organization) => void }) {
  const { updateOrganization } = useOrganizationsApi();
  const [servicesPublic, setServicesPublic] = useState(org.servicesPublic === true);
  const [visibility, setVisibility] = useState<NonNullable<Organization['visibility']>>(org.visibility ?? 'public');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const updated = await updateOrganization(org.id, { servicesPublic, visibility });
      onSaved(updated);
      setMessage('Settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-6 rounded-xl border border-tp-hairline bg-tp-surface p-6">
      <div>
        <h2 className="text-lg font-semibold">Organization settings</h2>
        <p className="mt-1 text-sm text-tp-steel">Control access to this organization and its services.</p>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">Organization visibility</legend>
        {([
          ['public', 'Public', 'Visible in discovery and accessible by link.'],
          ['unlisted', 'Only by link', 'Hidden from discovery; anyone with a link can access it.'],
          ['private', 'Private', 'Only members can access the organization, its collections and pricings.'],
        ] as const).map(([value, label, description]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="mt-1 cursor-pointer accent-tp-primary" />
            <span><span className="block font-medium">{label}</span><span className="block text-sm text-tp-steel">{description}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="flex cursor-pointer items-start gap-3">
        <input name="servicesPublic" type="checkbox" checked={servicesPublic} onChange={event => setServicesPublic(event.target.checked)} className="mt-1 cursor-pointer accent-tp-primary" />
        <span><span className="block font-medium">Publish the services tree</span><span className="block text-sm text-tp-steel">People with beta features enabled can see it when the organization is accessible to them. Private organizations remain limited to members.</span></span>
      </label>
      <button type="submit" disabled={saving} className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
      <p role="status" className="text-sm text-tp-steel">{message}</p>
    </form>
  );
}
