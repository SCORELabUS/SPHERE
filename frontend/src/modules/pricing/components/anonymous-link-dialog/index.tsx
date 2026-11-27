import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { FiCopy, FiCheck, FiTrash2, FiX } from 'react-icons/fi';
import customConfirm from '../../../core/utils/custom-confirm';
import { anonymousLinkStep, type AnonymousLinkStep } from '../../../core/utils/pricing-visibility';
import { anonymousLinkUrl, useAnonymousLinksApi } from '../../api/anonymousLinksApi';
import type { AnonymousLink } from '../../types/anonymous-links';
import type { VersionData } from '../../types/card';

interface AnonymousLinkDialogProps {
  pricingId: string;
  versions: VersionData[];
  /** The version the link will show. */
  selected: VersionData;
  unlisted: boolean;
  /** Unlists the pricing; resolves with its new ETag. */
  onMakeUnlisted: () => Promise<string | undefined>;
  /** Makes a private version visible with the link, with the ETag the previous change returned. */
  onMakeVersionVisible: (version: VersionData, etag: string | undefined) => Promise<string | undefined>;
  onClose: () => void;
}

export const ANONYMITY_NOTICE =
  'SPHERE hides who published this pricing, not what its YAML says: its name, URLs or comments may still identify you, ' +
  "and anyone who knows the organization and the pricing's name can open it.";

const primaryButton = 'cursor-pointer rounded-md bg-tp-primary px-3 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton = 'cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Creates and manages the anonymous links of a pricing: a link shows the
 * selected version to anyone without naming who published it. A private
 * version is never shared this way, and a listed pricing gets a warning first,
 * since search shows it next to its organization.
 */
export default function AnonymousLinkDialog({
  pricingId,
  versions,
  selected,
  unlisted,
  onMakeUnlisted,
  onMakeVersionVisible,
  onClose,
}: AnonymousLinkDialogProps) {
  const { listAnonymousLinks, createAnonymousLink, revokeAnonymousLink } = useAnonymousLinksApi();
  // Decided when the dialog opens; the actions below move it on.
  const [step, setStep] = useState<AnonymousLinkStep>(() => anonymousLinkStep(selected, versions, unlisted));
  const [allVersions, setAllVersions] = useState(false);
  const [links, setLinks] = useState<AnonymousLink[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AnonymousLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  // While the revoke confirmation is open, Escape belongs to it.
  const confirmingRef = useRef(false);

  useEffect(() => {
    let active = true;
    listAnonymousLinks(pricingId)
      .then(result => {
        if (!active) return;
        setLinks(result.links);
        setLimit(result.limit);
      })
      .catch(() => {
        // Only who may edit the pricing sees its links.
        if (active) setLinks(null);
      });
    return () => {
      active = false;
    };
  }, [pricingId, listAnonymousLinks]);

  // The focus enters the dialog: on the warning when there is one.
  useEffect(() => {
    if (step === 'listed-warning') alertRef.current?.focus();
    else dialogRef.current?.focus();
  }, [step]);

  // The button that created the link is gone; the focus moves to the link.
  useEffect(() => {
    if (created) linkRef.current?.focus();
  }, [created]);

  // Escape closes from anywhere, also once the focus has left the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmingRef.current) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const full = limit !== null && links !== null && links.length >= limit;

  /**
   * Runs the steps of an action. `done` collects what each step already
   * changed, so a later failure says so instead of "nothing was shared".
   */
  const run = async (action: (done: string[]) => Promise<void>) => {
    const done: string[] = [];
    setBusy(true);
    setError(null);
    try {
      await action(done);
    } catch (failure) {
      // fetch rejects with a TypeError ("Failed to fetch") when SPHERE cannot be reached.
      const reason = failure instanceof TypeError
        ? 'SPHERE could not be reached. Check your connection and try again'
        : (failure as { message?: string })?.message;
      setError(done.length > 0
        ? `${done.join(' and ')}, but the link was not created: ${reason?.replace(/\.$/, '') || 'something went wrong'}.`
        : reason ? (/[.!?]$/.test(reason) ? reason : `${reason}.`) : 'Something went wrong. Nothing was shared.');
    } finally {
      setBusy(false);
    }
  };

  const createLink = async () => {
    const shareVersion = allVersions ? versions.find(version => !version.private) : selected;
    if (!shareVersion) throw new Error('Make at least one version visible before sharing all versions');
    const link = allVersions ? await createAnonymousLink(shareVersion.id, true) : await createAnonymousLink(shareVersion.id);
    setCreated(link);
    setLinks(current => [link, ...(current ?? [])]);
    setStep('ready');
  };

  const makeUnlisted = async (done: string[]) => {
    const etag = await onMakeUnlisted();
    done.push('The pricing is now unlisted');
    // Not listed any more: nothing left to warn about.
    setStep(current => (current === 'listed-warning' ? 'ready' : current));
    return etag;
  };

  const create = () => run(createLink);

  const makeUnlistedAndCreate = () => run(async done => {
    await makeUnlisted(done);
    await createLink();
  });

  // Unlisted first: the version is never visible while the pricing is still listed.
  const makeVersionVisibleAndCreate = () => run(async done => {
    const etag = unlisted ? undefined : await makeUnlisted(done);
    await onMakeVersionVisible(selected, etag);
    done.push(`${done.length > 0 ? 'version' : 'Version'} ${selected.version} is now visible to anyone with the link`);
    setStep('ready');
    await createLink();
  });

  const copy = async (link: AnonymousLink) => {
    const url = anonymousLinkUrl(link.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(current => (current === link.id ? null : current)), 1800);
    } catch {
      window.prompt('Copy anonymous link', url);
    }
  };

  const revoke = (link: AnonymousLink) => {
    confirmingRef.current = true;
    customConfirm(
      `Revoke the anonymous link to ${link.allVersions ? 'all visible versions' : `version ${link.version}`}? Whoever opens it will see "This link is not available".`,
      { danger: true, confirmLabel: 'Revoke' }
    )
      .finally(() => {
        confirmingRef.current = false;
      })
      .then(() => run(async () => {
        await revokeAnonymousLink(link.id);
        setLinks(current => (current ?? []).filter(item => item.id !== link.id));
        setCreated(current => (current?.id === link.id ? null : current));
      }))
      .catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anonymous-link-title"
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full max-w-[32rem] cursor-default flex-col overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 outline-none"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-tp-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 id="anonymous-link-title" className="font-display text-lg font-semibold text-tp-ink">
              Anonymous link · {allVersions ? 'all visible versions' : `version ${selected.version}`}
            </h2>
            <p className="mt-0.5 text-xs text-tp-steel">
              Anyone with the link sees {allVersions ? 'the visible versions' : 'this version'} without anything that names you or your organization.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            <FiX className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset className="space-y-2 rounded-lg border border-tp-hairline p-3">
            <legend className="px-1 text-xs font-semibold text-tp-ink">Versions to share</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="anonymous-scope" checked={!allVersions} onChange={() => setAllVersions(false)} />Only version {selected.version}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="anonymous-scope" checked={allVersions} onChange={() => setAllVersions(true)} />All visible versions</label>
            {allVersions && <p className="text-xs text-tp-steel">Private versions stay hidden. New visible versions are included automatically.</p>}
          </fieldset>
          {step === 'private-version' && !allVersions && (
            <div className="rounded-lg border border-tp-hairline bg-tp-surface p-3">
              <p className="text-sm font-medium text-tp-ink">Version {selected.version} is private.</p>
              <p className="mt-1 text-xs text-tp-steel">
                Private versions cannot be shared through an anonymous link. You can make this version visible to
                anyone with the link, keeping the pricing out of search and its organization's page, and share it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy || full} onClick={makeVersionVisibleAndCreate} className={primaryButton}>
                  Make this version unlisted and create link
                </button>
                <button type="button" disabled={busy} onClick={onClose} className={secondaryButton}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {(step === 'listed-warning' || (step === 'private-version' && allVersions && !unlisted)) && (
            <div
              ref={alertRef}
              role="alertdialog"
              tabIndex={-1}
              aria-labelledby="anonymous-link-warning-title"
              aria-describedby="anonymous-link-warning-text"
              className="rounded-lg border border-tp-severity-warning-border bg-tp-severity-warning-bg p-3 outline-none"
            >
              <p id="anonymous-link-warning-title" className="text-sm font-medium text-tp-ink">
                This pricing is public.
              </p>
              <p id="anonymous-link-warning-text" className="mt-1 text-xs text-tp-slate">
                It shows in SPHERE's search and on its organization's page, where anyone can see who published it.
                Whoever opens the anonymous link could find it there, so the link alone does not keep your anonymity.
                Make it unlisted to keep it out of search while anyone with a link can still see it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy || full} onClick={makeUnlistedAndCreate} className={primaryButton}>
                  Make unlisted and create link
                </button>
                <button type="button" disabled={busy || full} onClick={create} className={secondaryButton}>
                  Create link anyway
                </button>
                <button type="button" disabled={busy} onClick={onClose} className={secondaryButton}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {(step === 'ready' || (step === 'private-version' && allVersions && unlisted)) && !created && (
            <button type="button" disabled={busy || full} onClick={create} className={primaryButton}>
              Create link
            </button>
          )}

          {full && <p className="text-xs text-tp-steel">This pricing has {limit} anonymous links. Revoke one to create another.</p>}

          {error && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {created && (
            <div className="rounded-lg bg-tp-surface p-2.5">
              <p className="mb-1.5 text-[11px] font-semibold text-tp-ink">Your anonymous link</p>
              <div className="flex items-center gap-1.5 rounded-md border border-tp-input-border bg-tp-input-bg p-1">
                <input
                  ref={linkRef}
                  aria-label="Anonymous pricing link"
                  readOnly
                  value={anonymousLinkUrl(created.token)}
                  onFocus={event => event.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[11px] text-tp-steel outline-none"
                />
                <button
                  type="button"
                  aria-label={copiedId === created.id ? 'Anonymous link copied' : 'Copy anonymous link'}
                  onClick={() => copy(created)}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-tp-primary text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
                >
                  {copiedId === created.id ? <FiCheck className="h-4 w-4" /> : <FiCopy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          <span className="sr-only" role="status" aria-live="polite">
            {copiedId ? 'Anonymous link copied to clipboard' : ''}
          </span>

          <p className="text-[11px] text-tp-steel">{ANONYMITY_NOTICE}</p>

          {links !== null && links.length > 0 && (
            <section aria-labelledby="anonymous-links-title">
              <h3 id="anonymous-links-title" className="mb-2 text-xs font-semibold text-tp-ink">
                Links of this pricing
              </h3>
              <ul className="divide-y divide-tp-hairline rounded-lg border border-tp-hairline">
                {links.map(link => (
                  <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-tp-ink">{link.allVersions ? 'All visible versions' : `Version ${link.version}`}</p>
                      <p className="text-[11px] text-tp-steel">
                        Created {format(parseISO(link.createdAt), 'PP')}
                        {!link.active && ' · Suspended while the version is private'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => copy(link)}
                        aria-label={`Copy the link to ${link.allVersions ? 'all visible versions' : `version ${link.version}`}`}
                        title="Copy link"
                        className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                      >
                        {copiedId === link.id ? <FiCheck className="h-4 w-4" /> : <FiCopy className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => revoke(link)}
                        aria-label={`Revoke the link to ${link.allVersions ? 'all visible versions' : `version ${link.version}`}`}
                        title="Revoke link"
                        className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <FiTrash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
