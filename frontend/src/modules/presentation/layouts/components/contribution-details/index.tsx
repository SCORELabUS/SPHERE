import { Contribution } from '../../../pages/contributions/data/contributions-data';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ContributionDetailsModal({
  selectedContribution,
  isOpen,
  handleClose,
}: Readonly<{
  selectedContribution: Contribution | null;
  isOpen: boolean;
  handleClose: () => void;
}>) {
  return (
    isOpen ? (
      <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/35 p-4" onClick={handleClose} role="presentation">
        <div
          className="flex h-[90dvh] w-[90%] max-w-300 flex-col overflow-hidden rounded-lg bg-white p-4 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {selectedContribution && (
            <>
              {/* Title */}
              <h2 className="mb-10 text-center text-4xl font-bold">
                {selectedContribution.title}
              </h2>

              {/* Content section with two columns */}
              <div className="flex h-full flex-col overflow-hidden md:flex-row">
                {/* Description Column */}
                <div className="flex-7 overflow-y-auto pr-0 text-justify md:pr-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-tp-ink underline">
                          {props.children}
                        </a>
                      ),
                      h3: ({ node, ...props }) => (
                        <h3 className="mt-6 font-bold" {...props} />
                      ),
                      ul: ({ node, ...props }) => (
                        <ul className="list-disc pl-6" {...props}>
                          {props.children}
                        </ul>
                      ),
                      li: ({ node, ...props }) => (
                        <li className="mb-2" {...props} />
                      ),
                    }}
                  >
                    {selectedContribution.markdownDescription}
                  </ReactMarkdown>
                </div>

                {/* Divider */}
                <div className="mx-2 hidden w-0.5 bg-slate-300 md:block" />

                {/* Supervisor and Tags Column */}
                <div className="flex flex-3 flex-col gap-2 overflow-y-auto">
                  <p className="font-bold">
                    Supervisor/s:
                  </p>
                  <p className="text-sm text-sphere-grey-600">
                    {selectedContribution.supervisor}
                  </p>

                  <p className="mt-2 font-bold">
                    Tags:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedContribution.tags.map(tag => tag)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    ) : null
  );
}
