import HarveyHeader from './harvey-header';

interface Props {
  children?: React.ReactNode;
  isPlayground?: boolean;
  onTogglePlayground?: () => void;
  onNewConversation?: () => void;
}

export default function HarveyLayout({ children, isPlayground, onTogglePlayground, onNewConversation }: Props) {
  return (
    <div className="flex h-dvh flex-col bg-tp-canvas">
      <HarveyHeader isPlayground={isPlayground} onTogglePlayground={onTogglePlayground} onNewConversation={onNewConversation} />
      {children}
    </div>
  );
}
