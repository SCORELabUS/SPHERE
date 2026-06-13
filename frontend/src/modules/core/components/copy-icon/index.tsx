import { grey } from '../../theme/palette';
import { useState } from 'react';

export default function CopyToClipboardIcon({ value }: { value: string }) {
  
  const [linkCopied, setLinkCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setLinkCopied(true);
      setTimeout(() => {
        setLinkCopied(false);
      }, 2000);
    });
  };

  return (
    <div
      className={`flex w-full overflow-hidden rounded-[5px] border ${linkCopied ? 'border-[#5BE49B]' : 'border-sphere-primary-800'}`}
    >
      <input
        value={value}
        readOnly
        className="grow rounded-l-xs py-0 pl-2 pr-0 outline-none"
      />
      <button
        onClick={handleCopy}
        type="button"
        className={`flex h-10 w-10 min-w-0 cursor-pointer items-center justify-center rounded-r-xs py-1 text-white ${linkCopied ? 'bg-[#5BE49B]' : 'bg-tp-primary'}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect fill="none"></rect>
          <rect
            x="4"
            y="8"
            width="12"
            height="12"
            rx="1"
            fill="none"
            stroke={grey[100]}
            strokeLinecap="round"
            strokeLinejoin="round"
          ></rect>
          <path
            d="M8 6V5C8 4.44772 8.44772 4 9 4H19C19.5523 4 20 4.44772 20 5V15C20 15.5523 19.5523 16 19 16H18"
            fill="none"
            stroke={grey[100]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 2"
          ></path>
        </svg>
      </button>
    </div>
  );
}
